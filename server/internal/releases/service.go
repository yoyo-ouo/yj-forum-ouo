// Package releases 读取 GitHub Releases 并提供下载页/客户端更新所需的清单与版本检查。
//
// 唯一数据源是 GitHub（默认 yoyo-ouo/yj-forum-nsh，即跨平台客户端的聚合发布仓库），
// 读不到时返回 error，不回退内置清单。
package releases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultRepo GitHub 仓库（owner/name）：客户端安装包统一发布在 NSH 仓库。
	DefaultRepo = "yoyo-ouo/yj-forum-nsh"

	defaultAPIBase   = "https://api.github.com"
	defaultCacheTTL  = 10 * time.Minute
	defaultUserAgent = "yj-forum-server"
	maxResponseBytes = 8 << 20
)

// 支持的平台（与下载页/客户端约定一致）。
const (
	PlatformWindows = "windows"
	PlatformAndroid = "android"
	PlatformLinux   = "linux"
	PlatformMacOS   = "macos"
)

// AllPlatforms 全部平台（顺序与下载页展示一致）。
var AllPlatforms = []string{PlatformWindows, PlatformAndroid, PlatformLinux, PlatformMacOS}

// 对外错误。
var (
	ErrUnknownPlatform = errors.New("未知平台")
	ErrNoRelease       = errors.New("暂无发布版本")
	ErrAssetNotFound   = errors.New("安装包不存在")
	ErrUpstream        = errors.New("读取 GitHub Releases 失败")
)

// Asset GitHub Release 附件。
//
// SHA256 来自 GitHub 的 digest 字段（形如 "sha256:..."）；旧版本资产可能为空。
type Asset struct {
	Platform string
	Version  string
	Filename string
	Size     int64
	URL      string
	SHA256   string
}

// Release 单个平台版本的公开结构（字段与 backend-contract 对齐）。
type Release struct {
	Version  string   `json:"version"`
	Channel  string   `json:"channel"` // stable | beta（GitHub prerelease）
	Date     string   `json:"date"`    // YYYY-MM-DD
	Size     int64    `json:"size"`
	URL      string   `json:"url"`
	Filename string   `json:"filename"`
	SHA256   string   `json:"sha256"`
	Notes    []string `json:"notes"`
	// NotesMarkdown 原始 Release 正文（Markdown）；Notes 保留为旧客户端兼容的纯文本行列表。
	NotesMarkdown string `json:"notes_markdown,omitempty"`
	Mandatory     bool   `json:"mandatory"`
	Platform      string `json:"platform"`

	// PublishedAt 发布时间（仅内部排序用）。
	PublishedAt time.Time `json:"-"`
	// assets 该 release 的全部附件（FindAsset 用）。
	assets []Asset
}

// ListResult 分页结果。
type ListResult struct {
	Items    []Release `json:"items"`
	Total    int       `json:"total"`
	Page     int       `json:"page"`
	PageSize int       `json:"page_size"`
}

// CheckResult 版本检查结果（available/mandatory 等字段供客户端渲染 426 更新提示）。
type CheckResult struct {
	Available   bool     `json:"available"`
	Mandatory   bool     `json:"mandatory"`
	Current     string   `json:"current"`
	Latest      string   `json:"latest"`
	MinVersion  string   `json:"min_version"`
	Release     *Release `json:"release"`
	DownloadURL string   `json:"download_url"`
}

// Service GitHub Releases 客户端（进程内 10 分钟缓存）。
type Service struct {
	repo    string
	token   string
	apiBase string
	client  *http.Client
	ttl     time.Duration

	mu        sync.Mutex
	cache     []Release
	fetchedAt time.Time
	loaded    bool
}

// Option 构造选项（测试可注入 httptest 服务与自定义 TTL）。
type Option func(*Service)

// WithHTTPClient 自定义 HTTP 客户端。
func WithHTTPClient(client *http.Client) Option {
	return func(s *Service) {
		if client != nil {
			s.client = client
		}
	}
}

// WithRepo 自定义发布仓库（owner/name），为空时保持 DefaultRepo。
func WithRepo(repo string) Option {
	return func(s *Service) {
		if v := strings.TrimSpace(repo); v != "" {
			s.repo = strings.Trim(v, "/")
		}
	}
}

// WithAPIBase 自定义 GitHub API 根地址（测试用）。
func WithAPIBase(base string) Option {
	return func(s *Service) {
		if strings.TrimSpace(base) != "" {
			s.apiBase = strings.TrimRight(strings.TrimSpace(base), "/")
		}
	}
}

// WithCacheTTL 自定义缓存有效期。
func WithCacheTTL(ttl time.Duration) Option {
	return func(s *Service) {
		if ttl > 0 {
			s.ttl = ttl
		}
	}
}

// NewService 创建 GitHub Releases 客户端；token 为空时不带 Authorization。
func NewService(token string, opts ...Option) *Service {
	s := &Service{
		repo:    DefaultRepo,
		token:   strings.TrimSpace(token),
		apiBase: defaultAPIBase,
		client:  &http.Client{Timeout: 10 * time.Second},
		ttl:     defaultCacheTTL,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
	}
	return s
}

// List 分页返回发布列表；platform 为空表示全部平台。
func (s *Service) List(page, pageSize int, platform string) (*ListResult, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	p, err := normalizePlatform(platform, true)
	if err != nil {
		return nil, err
	}
	all, err := s.load()
	if err != nil {
		return nil, err
	}
	filtered := make([]Release, 0, len(all))
	for _, r := range all {
		if p != "" && r.Platform != p {
			continue
		}
		filtered = append(filtered, cloneRelease(r))
	}
	total := len(filtered)
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	items := make([]Release, 0, end-start)
	items = append(items, filtered[start:end]...)
	return &ListResult{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

// Latest 返回平台最新版本：优先最新 stable；平台只有 beta 时回退到最新 beta。
func (s *Service) Latest(platform string) (*Release, error) {
	p, err := normalizePlatform(platform, false)
	if err != nil {
		return nil, err
	}
	all, err := s.load()
	if err != nil {
		return nil, err
	}
	latest := pickLatest(all, p)
	if latest == nil {
		return nil, fmt.Errorf("%w: %s", ErrNoRelease, p)
	}
	out := cloneRelease(*latest)
	return &out, nil
}

// Check 检查平台版本：available=有更新，mandatory=current<min_versions（该平台最新 stable）。
func (s *Service) Check(platform, version string) (*CheckResult, error) {
	p, err := normalizePlatform(platform, false)
	if err != nil {
		return nil, err
	}
	current := strings.TrimSpace(version)
	if current == "" {
		current = "0.0.0"
	}
	all, err := s.load()
	if err != nil {
		return nil, err
	}
	res := &CheckResult{Current: current}
	latest := pickLatest(all, p)
	if latest == nil {
		return res, nil
	}
	res.Latest = latest.Version
	res.DownloadURL = latest.URL
	if min := latestStableVersion(all, p); min != "" {
		res.MinVersion = min
		if compareVersions(current, min) < 0 {
			res.Mandatory = true
		}
	}
	if compareVersions(latest.Version, current) > 0 {
		res.Available = true
		release := cloneRelease(*latest)
		res.Release = &release
	}
	return res, nil
}

// FindAsset 在平台的全部 release 中按文件名查找附件（优先最新 stable）。
func (s *Service) FindAsset(platform, filename string) (*Asset, error) {
	p, err := normalizePlatform(platform, false)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(filename)
	if !assetNameRe.MatchString(name) {
		return nil, ErrAssetNotFound
	}
	all, err := s.load()
	if err != nil {
		return nil, err
	}
	var best *Asset
	var fallback *Asset
	for i := range all {
		r := &all[i]
		if r.Platform != p {
			continue
		}
		for j := range r.assets {
			a := r.assets[j]
			if a.Filename != name {
				continue
			}
			if r.Channel == "stable" {
				if best == nil || compareVersions(a.Version, best.Version) > 0 {
					copy := a
					best = &copy
				}
			} else if fallback == nil {
				copy := a
				fallback = &copy
			}
		}
	}
	if best != nil {
		return best, nil
	}
	if fallback != nil {
		return fallback, nil
	}
	return nil, ErrAssetNotFound
}

// load 读取缓存；超过 TTL 时重新请求 GitHub（并发请求串行化，避免缓存击穿）。
func (s *Service) load() ([]Release, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded && time.Since(s.fetchedAt) < s.ttl {
		return s.cache, nil
	}
	items, err := s.fetch()
	if err != nil {
		return nil, err
	}
	s.cache = items
	s.fetchedAt = time.Now()
	s.loaded = true
	return s.cache, nil
}

// githubRelease GitHub API 原始结构（仅取所需字段）。
type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Body        string        `json:"body"`
	Draft       bool          `json:"draft"`
	Prerelease  bool          `json:"prerelease"`
	PublishedAt time.Time     `json:"published_at"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Digest             string `json:"digest"`
}

// fetch 拉取全部 release（每页 100，最多 10 页），进程内缓存后由 List 内存分页。
func (s *Service) fetch() ([]Release, error) {
	const maxPages = 10
	all := make([]githubRelease, 0, 100)
	for page := 1; page <= maxPages; page++ {
		raw, err := s.fetchPage(page)
		if err != nil {
			return nil, err
		}
		all = append(all, raw...)
		if len(raw) < 100 {
			break
		}
	}
	return parseReleases(all), nil
}

func (s *Service) fetchPage(page int) ([]githubRelease, error) {
	url := fmt.Sprintf("%s/repos/%s/releases?per_page=100&page=%d", s.apiBase, s.repo, page)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", defaultUserAgent)
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("%w: HTTP %d %s", ErrUpstream, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var raw []githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&raw); err != nil {
		return nil, fmt.Errorf("%w: 解析响应失败: %v", ErrUpstream, err)
	}
	return raw, nil
}

// versionTagRe 解析版本标签：v1.3.18 / 1.3.18 / v1.4.0-beta。
//
// NSH 一次构建多平台，一个 Release 里同时带 Windows/Android/Linux 安装包，
// 因此 tag 只放版本号，平台由附件名识别（见 assetPlatform）。
var versionTagRe = regexp.MustCompile(`(?i)^(?:(?:windows|android|linux|macos|darwin)-)?v?(\d+(?:\.\d+)*)(?:[-+][0-9A-Za-z._-]+)?// Package releases 读取 GitHub Releases 并提供下载页/客户端更新所需的清单与版本检查。
//
// 唯一数据源是 GitHub（默认 yoyo-ouo/yj-forum-nsh，即跨平台客户端的聚合发布仓库），
// 读不到时返回 error，不回退内置清单。
package releases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultRepo GitHub 仓库（owner/name）：客户端安装包统一发布在 NSH 仓库。
	DefaultRepo = "yoyo-ouo/yj-forum-nsh"

	defaultAPIBase   = "https://api.github.com"
	defaultCacheTTL  = 10 * time.Minute
	defaultUserAgent = "yj-forum-server"
	maxResponseBytes = 8 << 20
)

// 支持的平台（与下载页/客户端约定一致）。
const (
	PlatformWindows = "windows"
	PlatformAndroid = "android"
	PlatformLinux   = "linux"
	PlatformMacOS   = "macos"
)

// AllPlatforms 全部平台（顺序与下载页展示一致）。
var AllPlatforms = []string{PlatformWindows, PlatformAndroid, PlatformLinux, PlatformMacOS}

// 对外错误。
var (
	ErrUnknownPlatform = errors.New("未知平台")
	ErrNoRelease       = errors.New("暂无发布版本")
	ErrAssetNotFound   = errors.New("安装包不存在")
	ErrUpstream        = errors.New("读取 GitHub Releases 失败")
)

// Asset GitHub Release 附件。
//
// SHA256 来自 GitHub 的 digest 字段（形如 "sha256:..."）；旧版本资产可能为空。
type Asset struct {
	Platform string
	Version  string
	Filename string
	Size     int64
	URL      string
	SHA256   string
}

// Release 单个平台版本的公开结构（字段与 backend-contract 对齐）。
type Release struct {
	Version  string   `json:"version"`
	Channel  string   `json:"channel"` // stable | beta（GitHub prerelease）
	Date     string   `json:"date"`    // YYYY-MM-DD
	Size     int64    `json:"size"`
	URL      string   `json:"url"`
	Filename string   `json:"filename"`
	SHA256   string   `json:"sha256"`
	Notes    []string `json:"notes"`
	// NotesMarkdown 原始 Release 正文（Markdown）；Notes 保留为旧客户端兼容的纯文本行列表。
	NotesMarkdown string `json:"notes_markdown,omitempty"`
	Mandatory     bool   `json:"mandatory"`
	Platform      string `json:"platform"`

	// PublishedAt 发布时间（仅内部排序用）。
	PublishedAt time.Time `json:"-"`
	// assets 该 release 的全部附件（FindAsset 用）。
	assets []Asset
}

// ListResult 分页结果。
type ListResult struct {
	Items    []Release `json:"items"`
	Total    int       `json:"total"`
	Page     int       `json:"page"`
	PageSize int       `json:"page_size"`
}

// CheckResult 版本检查结果（available/mandatory 等字段供客户端渲染 426 更新提示）。
type CheckResult struct {
	Available   bool     `json:"available"`
	Mandatory   bool     `json:"mandatory"`
	Current     string   `json:"current"`
	Latest      string   `json:"latest"`
	MinVersion  string   `json:"min_version"`
	Release     *Release `json:"release"`
	DownloadURL string   `json:"download_url"`
}

// Service GitHub Releases 客户端（进程内 10 分钟缓存）。
type Service struct {
	repo    string
	token   string
	apiBase string
	client  *http.Client
	ttl     time.Duration

	mu        sync.Mutex
	cache     []Release
	fetchedAt time.Time
	loaded    bool
}

// Option 构造选项（测试可注入 httptest 服务与自定义 TTL）。
type Option func(*Service)

// WithHTTPClient 自定义 HTTP 客户端。
func WithHTTPClient(client *http.Client) Option {
	return func(s *Service) {
		if client != nil {
			s.client = client
		}
	}
}

// WithRepo 自定义发布仓库（owner/name），为空时保持 DefaultRepo。
func WithRepo(repo string) Option {
	return func(s *Service) {
		if v := strings.TrimSpace(repo); v != "" {
			s.repo = strings.Trim(v, "/")
		}
	}
}

// WithAPIBase 自定义 GitHub API 根地址（测试用）。
func WithAPIBase(base string) Option {
	return func(s *Service) {
		if strings.TrimSpace(base) != "" {
			s.apiBase = strings.TrimRight(strings.TrimSpace(base), "/")
		}
	}
}

// WithCacheTTL 自定义缓存有效期。
func WithCacheTTL(ttl time.Duration) Option {
	return func(s *Service) {
		if ttl > 0 {
			s.ttl = ttl
		}
	}
}

// NewService 创建 GitHub Releases 客户端；token 为空时不带 Authorization。
func NewService(token string, opts ...Option) *Service {
	s := &Service{
		repo:    DefaultRepo,
		token:   strings.TrimSpace(token),
		apiBase: defaultAPIBase,
		client:  &http.Client{Timeout: 10 * time.Second},
		ttl:     defaultCacheTTL,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
	}
	return s
}

// List 分页返回发布列表；platform 为空表示全部平台。
func (s *Service) List(page, pageSize int, platform string) (*ListResult, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	p, err := normalizePlatform(platform, true)
	if err != nil {
		return nil, err
	}
	all, err := s.load()
	if err != nil {
		return nil, err
	}
	filtered := make([]Release, 0, len(all))
	for _, r := range all {
		if p != "" && r.Platform != p {
			continue
		}
		filtered = append(filtered, cloneRelease(r))
	}
	total := len(filtered)
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	items := make([]Release, 0, end-start)
	items = append(items, filtered[start:end]...)
	return &ListResult{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

// Latest 返回平台最新版本：优先最新 stable；平台只有 beta 时回退到最新 beta。
func (s *Service) Latest(platform string) (*Release, error) {
	p, err := normalizePlatform(platform, false)
	if err != nil {
		return nil, err
	}
	all, err := s.load()
	if err != nil {
		return nil, err
	}
	latest := pickLatest(all, p)
	if latest == nil {
		return nil, fmt.Errorf("%w: %s", ErrNoRelease, p)
	}
	out := cloneRelease(*latest)
	return &out, nil
}

// Check 检查平台版本：available=有更新，mandatory=current<min_versions（该平台最新 stable）。
func (s *Service) Check(platform, version string) (*CheckResult, error) {
	p, err := normalizePlatform(platform, false)
	if err != nil {
		return nil, err
	}
	current := strings.TrimSpace(version)
	if current == "" {
		current = "0.0.0"
	}
	all, err := s.load()
	if err != nil {
		return nil, err
	}
	res := &CheckResult{Current: current}
	latest := pickLatest(all, p)
	if latest == nil {
		return res, nil
	}
	res.Latest = latest.Version
	res.DownloadURL = latest.URL
	if min := latestStableVersion(all, p); min != "" {
		res.MinVersion = min
		if compareVersions(current, min) < 0 {
			res.Mandatory = true
		}
	}
	if compareVersions(latest.Version, current) > 0 {
		res.Available = true
		release := cloneRelease(*latest)
		res.Release = &release
	}
	return res, nil
}

// FindAsset 在平台的全部 release 中按文件名查找附件（优先最新 stable）。
func (s *Service) FindAsset(platform, filename string) (*Asset, error) {
	p, err := normalizePlatform(platform, false)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(filename)
	if !assetNameRe.MatchString(name) {
		return nil, ErrAssetNotFound
	}
	all, err := s.load()
	if err != nil {
		return nil, err
	}
	var best *Asset
	var fallback *Asset
	for i := range all {
		r := &all[i]
		if r.Platform != p {
			continue
		}
		for j := range r.assets {
			a := r.assets[j]
			if a.Filename != name {
				continue
			}
			if r.Channel == "stable" {
				if best == nil || compareVersions(a.Version, best.Version) > 0 {
					copy := a
					best = &copy
				}
			} else if fallback == nil {
				copy := a
				fallback = &copy
			}
		}
	}
	if best != nil {
		return best, nil
	}
	if fallback != nil {
		return fallback, nil
	}
	return nil, ErrAssetNotFound
}

// load 读取缓存；超过 TTL 时重新请求 GitHub（并发请求串行化，避免缓存击穿）。
func (s *Service) load() ([]Release, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded && time.Since(s.fetchedAt) < s.ttl {
		return s.cache, nil
	}
	items, err := s.fetch()
	if err != nil {
		return nil, err
	}
	s.cache = items
	s.fetchedAt = time.Now()
	s.loaded = true
	return s.cache, nil
}

// githubRelease GitHub API 原始结构（仅取所需字段）。
type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Body        string        `json:"body"`
	Draft       bool          `json:"draft"`
	Prerelease  bool          `json:"prerelease"`
	PublishedAt time.Time     `json:"published_at"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Digest             string `json:"digest"`
}

// fetch 拉取全部 release（每页 100，最多 10 页），进程内缓存后由 List 内存分页。
func (s *Service) fetch() ([]Release, error) {
	const maxPages = 10
	all := make([]githubRelease, 0, 100)
	for page := 1; page <= maxPages; page++ {
		raw, err := s.fetchPage(page)
		if err != nil {
			return nil, err
		}
		all = append(all, raw...)
		if len(raw) < 100 {
			break
		}
	}
	return parseReleases(all), nil
}

func (s *Service) fetchPage(page int) ([]githubRelease, error) {
	url := fmt.Sprintf("%s/repos/%s/releases?per_page=100&page=%d", s.apiBase, s.repo, page)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", defaultUserAgent)
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("%w: HTTP %d %s", ErrUpstream, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var raw []githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&raw); err != nil {
		return nil, fmt.Errorf("%w: 解析响应失败: %v", ErrUpstream, err)
	}
	return raw, nil
}

// versionTagRe 解析版本标签：v1.3.18 / 1.3.18 / v1.4.0-beta。
//
// NSH 一次构建多平台，一个 Release 里同时带 Windows/Android/Linux 安装包，
// 因此 tag 只放版本号，平台由附件名识别（见 assetPlatform）。
)

// assetNameRe 附件名白名单（防目录穿越）。
var assetNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func parseVersionTag(tag string) (version string, ok bool) {
	m := versionTagRe.FindStringSubmatch(strings.TrimSpace(tag))
	if m == nil {
		return "", false
	}
	return m[1], true
}

// assetPlatform 按附件名判断平台：文件名关键词优先，扩展名兜底。
//
// 文件名示例：yj-forum-windows-1.2.0.zip / yj-forum-android-1.2.0.apk /
// yj-forum-linux-1.2.0.tar.gz。无关键词的裸 .zip 按 Windows 处理。
func assetPlatform(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" {
		return ""
	}
	switch {
	case strings.Contains(lower, "android"), strings.HasSuffix(lower, ".apk"), strings.HasSuffix(lower, ".aab"):
		return PlatformAndroid
	case strings.Contains(lower, "windows"), strings.HasSuffix(lower, ".exe"), strings.HasSuffix(lower, ".msi"):
		return PlatformWindows
	case strings.Contains(lower, "linux"), strings.HasSuffix(lower, ".appimage"),
		strings.HasSuffix(lower, ".deb"), strings.HasSuffix(lower, ".rpm"), strings.HasSuffix(lower, ".tar.gz"):
		return PlatformLinux
	case strings.Contains(lower, "macos"), strings.Contains(lower, "darwin"),
		strings.HasSuffix(lower, ".dmg"), strings.HasSuffix(lower, ".pkg"):
		return PlatformMacOS
	case strings.HasSuffix(lower, ".zip"):
		// 无平台关键词的裸 zip：NSH 的 Windows 产物是 zip
		return PlatformWindows
	}
	return ""
}

func parseReleases(raw []githubRelease) []Release {
	out := make([]Release, 0, len(raw))
	for _, gr := range raw {
		if gr.Draft {
			continue
		}
		version, ok := parseVersionTag(gr.TagName)
		if !ok {
			continue
		}
		grouped := groupAssetsByPlatform(version, gr.Assets)
		if len(grouped) == 0 {
			continue
		}
		channel := "stable"
		if gr.Prerelease {
			channel = "beta"
		}
		date := ""
		if !gr.PublishedAt.IsZero() {
			date = gr.PublishedAt.UTC().Format("2006-01-02")
		}
		notes := parseNotes(gr.Body)
		// 同一个 Release 按平台拆成多条，各平台共用版本/日期/更新说明
		for platform, assets := range grouped {
			primary := pickPrimaryAsset(platform, assets)
			out = append(out, Release{
				Version:       version,
				Channel:       channel,
				Date:          date,
				Size:          primary.Size,
				URL:           primary.URL,
				Filename:      primary.Filename,
				SHA256:        primary.SHA256,
				Notes:         notes,
				NotesMarkdown: gr.Body,
				Platform:      platform,
				PublishedAt:   gr.PublishedAt,
				assets:        assets,
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].PublishedAt.Equal(out[j].PublishedAt) {
			return out[i].PublishedAt.After(out[j].PublishedAt)
		}
		if c := compareVersions(out[i].Version, out[j].Version); c != 0 {
			return c > 0
		}
		return out[i].Filename < out[j].Filename
	})
	return out
}

// groupAssetsByPlatform 把同一 Release 的附件按平台分组（NSH 一次构建多平台）。
// 无法识别的附件（如 latest.json、.sha256）会被忽略。
func groupAssetsByPlatform(version string, raw []githubAsset) map[string][]Asset {
	grouped := make(map[string][]Asset)
	for _, ga := range raw {
		name := strings.TrimSpace(ga.Name)
		url := strings.TrimSpace(ga.BrowserDownloadURL)
		if name == "" || url == "" {
			continue
		}
		platform := assetPlatform(name)
		if platform == "" {
			continue
		}
		grouped[platform] = append(grouped[platform], Asset{
			Platform: platform,
			Version:  version,
			Filename: name,
			Size:     ga.Size,
			URL:      url,
			SHA256:   normalizeDigest(ga.Digest),
		})
	}
	return grouped
}

func normalizeDigest(digest string) string {
	digest = strings.TrimSpace(digest)
	if len(digest) > 7 && strings.EqualFold(digest[:7], "sha256:") {
		return digest[7:]
	}
	return digest
}

// platformAssetExts 各平台优先选取的附件扩展名。
var platformAssetExts = map[string][]string{
	PlatformWindows: {".exe", ".msi", ".zip"},
	PlatformAndroid: {".apk"},
	PlatformLinux:   {".appimage", ".deb", ".rpm", ".tar.gz", ".zip"},
	PlatformMacOS:   {".dmg", ".pkg", ".zip"},
}

func pickPrimaryAsset(platform string, assets []Asset) Asset {
	for _, ext := range platformAssetExts[platform] {
		for _, a := range assets {
			if strings.HasSuffix(strings.ToLower(a.Filename), ext) {
				return a
			}
		}
	}
	return assets[0]
}

func parseNotes(body string) []string {
	notes := make([]string, 0)
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		for _, prefix := range []string{"- ", "* ", "• "} {
			if strings.HasPrefix(line, prefix) {
				line = strings.TrimSpace(strings.TrimPrefix(line, prefix))
				break
			}
		}
		if line != "" {
			notes = append(notes, line)
		}
	}
	return notes
}

func cloneRelease(r Release) Release {
	out := r
	out.Notes = append([]string{}, r.Notes...)
	out.assets = append([]Asset(nil), r.assets...)
	return out
}

func normalizePlatform(platform string, allowEmpty bool) (string, error) {
	p := strings.ToLower(strings.TrimSpace(platform))
	if p == "" {
		if allowEmpty {
			return "", nil
		}
		return "", ErrUnknownPlatform
	}
	for _, known := range AllPlatforms {
		if p == known {
			return p, nil
		}
	}
	return "", fmt.Errorf("%w: %s", ErrUnknownPlatform, platform)
}

func pickLatest(all []Release, platform string) *Release {
	var bestStable *Release
	var bestAny *Release
	for i := range all {
		r := &all[i]
		if r.Platform != platform {
			continue
		}
		if bestAny == nil || newerRelease(r, bestAny) {
			bestAny = r
		}
		if r.Channel == "stable" && (bestStable == nil || newerRelease(r, bestStable)) {
			bestStable = r
		}
	}
	if bestStable != nil {
		return bestStable
	}
	return bestAny
}

func latestStableVersion(all []Release, platform string) string {
	var best *Release
	for i := range all {
		r := &all[i]
		if r.Platform != platform || r.Channel != "stable" {
			continue
		}
		if best == nil || newerRelease(r, best) {
			best = r
		}
	}
	if best == nil {
		return ""
	}
	return best.Version
}

func newerRelease(a, b *Release) bool {
	if c := compareVersions(a.Version, b.Version); c != 0 {
		return c > 0
	}
	return a.PublishedAt.After(b.PublishedAt)
}

// parseVersion 把 "1.2.3" / "v1.2.3" 解析为数字段；非法段截断。
func parseVersion(v string) []int {
	v = strings.TrimSpace(v)
	v = strings.TrimLeft(v, "vV")
	if v == "" {
		return nil
	}
	parts := make([]int, 0, 4)
	for _, segment := range strings.Split(v, ".") {
		n := 0
		found := false
		for _, ch := range segment {
			if ch < '0' || ch > '9' {
				break
			}
			n = n*10 + int(ch-'0')
			found = true
		}
		if !found {
			break
		}
		parts = append(parts, n)
	}
	return parts
}

// compareVersions 逐段比较（短的一侧补 0）：a<b=-1，a==b=0，a>b=1。
func compareVersions(a, b string) int {
	va, vb := parseVersion(a), parseVersion(b)
	size := len(va)
	if len(vb) > size {
		size = len(vb)
	}
	for i := 0; i < size; i++ {
		x, y := 0, 0
		if i < len(va) {
			x = va[i]
		}
		if i < len(vb) {
			y = vb[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}
