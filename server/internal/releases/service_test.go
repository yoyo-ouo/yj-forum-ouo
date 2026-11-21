package releases

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

func fixture(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile("testdata/releases.json")
	if err != nil {
		t.Fatalf("读取 fixture 失败: %v", err)
	}
	return string(data)
}

// newTestService 启动 httptest GitHub API，返回客户端与请求计数。
func newTestService(t *testing.T, body string, status int) (*Service, *int32) {
	t.Helper()
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if r.URL.Path != "/repos/"+DefaultRepo+"/releases" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("per_page"); got != "100" {
			t.Errorf("per_page = %q, want 100", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	svc := NewService("", WithAPIBase(srv.URL), WithHTTPClient(srv.Client()))
	return svc, &hits
}

func TestParseGitHubReleases(t *testing.T) {
	svc, _ := newTestService(t, fixture(t), http.StatusOK)

	result, err := svc.List(1, 20, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	// 每个 Release 按平台拆成多条：1.4.0-beta 三平台 + 1.3.18 三平台 + 1.0.16 + 1.0.0
	if result.Total != 8 || len(result.Items) != 8 {
		t.Fatalf("total=%d items=%d, want 8/8", result.Total, len(result.Items))
	}
	// 按发布时间降序；同一 Release 内按首选附件名排序（android < linux < windows）
	if result.Items[0].Version != "1.4.0" || result.Items[0].Channel != "beta" || result.Items[0].Platform != PlatformAndroid {
		t.Errorf("first = %s/%s/%s, want 1.4.0/beta/android", result.Items[0].Version, result.Items[0].Channel, result.Items[0].Platform)
	}

	var win *Release
	for i := range result.Items {
		if result.Items[i].Platform == PlatformWindows && result.Items[i].Version == "1.3.18" {
			win = &result.Items[i]
		}
	}
	if win == nil {
		t.Fatal("缺少 Windows 1.3.18")
	}
	if win.Channel != "stable" {
		t.Errorf("channel = %q, want stable", win.Channel)
	}
	if win.Date != "2026-10-10" {
		t.Errorf("date = %q, want 2026-10-10", win.Date)
	}
	if win.Size != 158186366 {
		t.Errorf("size = %d", win.Size)
	}
	if win.Filename != "yj-forum-windows.zip" {
		t.Errorf("filename = %q", win.Filename)
	}
	if win.URL != "https://github.com/yoyo-ouo/yj-forum-nsh/releases/download/v1.3.18/yj-forum-windows.zip" {
		t.Errorf("url = %q", win.URL)
	}
	if win.SHA256 != "1a78cd3930a7ebe7f3f28bb48689131a33e4762a7a304a159b67af2710e6e672" {
		t.Errorf("sha256 = %q", win.SHA256)
	}
	if win.Mandatory {
		t.Errorf("list item mandatory should be false")
	}
	if len(win.Notes) != 2 || win.Notes[0] != "无限历纪年改为 1 起算" {
		t.Errorf("notes = %#v", win.Notes)
	}
	wantMarkdown := "## 修复\n- 无限历纪年改为 1 起算\n- 设置页「年制换算」支持无限元年\n\n"
	if win.NotesMarkdown != wantMarkdown {
		t.Errorf("notes_markdown = %q, want %q", win.NotesMarkdown, wantMarkdown)
	}

	var android *Release
	for i := range result.Items {
		if result.Items[i].Platform == PlatformAndroid {
			android = &result.Items[i]
		}
	}
	if android == nil || android.Version != "1.0.16" || android.Filename != "yj-forum-android-1.0.16.apk" {
		t.Errorf("android = %#v", android)
	}
	// 同一 Release 的其它平台资产不应混入 android 条目
	if android != nil && len(android.assets) != 1 {
		t.Errorf("android assets = %d, want 1", len(android.assets))
	}
}

func TestListPagination(t *testing.T) {
	svc, _ := newTestService(t, fixture(t), http.StatusOK)

	r1, err := svc.List(1, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	if r1.Total != 8 || len(r1.Items) != 2 || r1.Page != 1 || r1.PageSize != 2 {
		t.Fatalf("page1 = %+v", r1)
	}
	r2, err := svc.List(2, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(r2.Items) != 2 || r2.Items[0].Platform != PlatformWindows || r2.Items[0].Version != "1.4.0" {
		t.Fatalf("page2 = %+v", r2.Items)
	}
	r3, err := svc.List(5, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(r3.Items) != 0 || r3.Items == nil {
		t.Fatalf("page3 items = %#v, want empty non-nil", r3.Items)
	}

	win, err := svc.List(1, 20, "windows")
	if err != nil {
		t.Fatal(err)
	}
	if win.Total != 2 || len(win.Items) != 2 {
		t.Fatalf("windows total=%d len=%d", win.Total, len(win.Items))
	}
	androidList, err := svc.List(1, 20, "android")
	if err != nil {
		t.Fatal(err)
	}
	if androidList.Total != 3 {
		t.Fatalf("android total=%d, want 3", androidList.Total)
	}

	// page/pageSize 非法时回默认值
	def, err := svc.List(0, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if def.Page != 1 || def.PageSize != 20 {
		t.Fatalf("defaults page=%d page_size=%d", def.Page, def.PageSize)
	}

	if _, err := svc.List(1, 20, "solaris"); !errors.Is(err, ErrUnknownPlatform) {
		t.Fatalf("unknown platform err = %v", err)
	}
}

func TestLatestPrefersStable(t *testing.T) {
	svc, _ := newTestService(t, fixture(t), http.StatusOK)
	latest, err := svc.Latest(PlatformWindows)
	if err != nil {
		t.Fatal(err)
	}
	if latest.Version != "1.3.18" || latest.Channel != "stable" {
		t.Fatalf("latest = %s/%s, want 1.3.18/stable", latest.Version, latest.Channel)
	}
	// cloneRelease 需保留 Markdown 原文（string 直接赋值）
	if !strings.HasPrefix(latest.NotesMarkdown, "## 修复") {
		t.Errorf("latest.notes_markdown = %q, want raw markdown body", latest.NotesMarkdown)
	}
}

func TestReleaseJSONNotesMarkdown(t *testing.T) {
	raw, err := json.Marshal(Release{Version: "1.0.0", Notes: []string{"a"}, NotesMarkdown: "- a"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"notes_markdown":"- a"`) {
		t.Fatalf("json = %s, want notes_markdown field", raw)
	}
}

func TestCheck426Fields(t *testing.T) {
	svc, _ := newTestService(t, fixture(t), http.StatusOK)

	res, err := svc.Check(PlatformWindows, "1.3.0")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Available || !res.Mandatory {
		t.Errorf("available=%v mandatory=%v, want true/true", res.Available, res.Mandatory)
	}
	if res.Current != "1.3.0" || res.Latest != "1.3.18" || res.MinVersion != "1.3.18" {
		t.Errorf("current/latest/min = %q/%q/%q", res.Current, res.Latest, res.MinVersion)
	}
	if res.Release == nil || res.Release.Version != "1.3.18" {
		t.Errorf("release = %#v", res.Release)
	}
	if res.DownloadURL == "" {
		t.Errorf("download_url should not be empty")
	}

	upToDate, err := svc.Check(PlatformWindows, "1.3.18")
	if err != nil {
		t.Fatal(err)
	}
	if upToDate.Available || upToDate.Mandatory || upToDate.Release != nil {
		t.Errorf("up-to-date = %+v", upToDate)
	}

	// 短版本号按 0 补齐：1.3 == 1.3.0 < 1.3.18
	short, err := svc.Check(PlatformWindows, "1.3")
	if err != nil {
		t.Fatal(err)
	}
	if !short.Mandatory {
		t.Errorf("1.3 should be mandatory")
	}

	if _, err := svc.Check("solaris", "1.0.0"); !errors.Is(err, ErrUnknownPlatform) {
		t.Fatalf("unknown platform err = %v", err)
	}
}

func TestFindAsset(t *testing.T) {
	svc, _ := newTestService(t, fixture(t), http.StatusOK)

	asset, err := svc.FindAsset(PlatformWindows, "yj-forum-windows.zip")
	if err != nil {
		t.Fatal(err)
	}
	// 同名文件存在 beta 与 stable：优先 stable 1.3.18
	if asset.Version != "1.3.18" || !strings.Contains(asset.URL, "v1.3.18") {
		t.Fatalf("asset = %+v", asset)
	}
	if asset.Size != 158186366 || asset.SHA256 == "" {
		t.Errorf("asset size/sha = %d/%q", asset.Size, asset.SHA256)
	}

	portable, err := svc.FindAsset(PlatformWindows, "yj-forum-windows-portable.zip")
	if err != nil || portable.Version != "1.3.18" {
		t.Fatalf("portable = %+v err=%v", portable, err)
	}

	if _, err := svc.FindAsset(PlatformAndroid, "yj-forum-windows.zip"); !errors.Is(err, ErrAssetNotFound) {
		t.Fatalf("wrong platform err = %v", err)
	}
	if _, err := svc.FindAsset(PlatformWindows, "../../etc/passwd"); !errors.Is(err, ErrAssetNotFound) {
		t.Fatalf("traversal err = %v", err)
	}
	if _, err := svc.FindAsset(PlatformWindows, "missing.exe"); !errors.Is(err, ErrAssetNotFound) {
		t.Fatalf("missing err = %v", err)
	}
}

func TestCacheTenMinutes(t *testing.T) {
	svc, hits := newTestService(t, fixture(t), http.StatusOK)
	for i := 0; i < 3; i++ {
		if _, err := svc.List(1, 20, ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.Latest(PlatformWindows); err != nil {
		t.Fatal(err)
	}
	if got := atomic.LoadInt32(hits); got != 1 {
		t.Fatalf("GitHub requests = %d, want 1 (10min cache)", got)
	}
}

func TestFetchErrorReturnsError(t *testing.T) {
	svc, _ := newTestService(t, "rate limited", http.StatusForbidden)
	if _, err := svc.List(1, 20, ""); !errors.Is(err, ErrUpstream) {
		t.Fatalf("HTTP error = %v, want ErrUpstream", err)
	}

	bad, _ := newTestService(t, "{", http.StatusOK)
	if _, err := bad.Latest(PlatformWindows); !errors.Is(err, ErrUpstream) {
		t.Fatalf("JSON error = %v, want ErrUpstream", err)
	}
}

func TestParseVersionTagAndAssetPlatform(t *testing.T) {
	cases := []struct {
		tag     string
		version string
		ok      bool
	}{
		{"v1.3.18", "1.3.18", true},
		{"1.0.16", "1.0.16", true},
		{"V2.0.0", "2.0.0", true},
		{"v1.4.0-beta", "1.4.0", true},
		{"v2.0.0+build.5", "2.0.0", true},
		{"Windows-V1.3.18", "1.3.18", true},
		{"Android-V2.1.0", "2.1.0", true},
		{"Linux-v1.2.3", "1.2.3", true},
		{"Docs-2026", "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		version, ok := parseVersionTag(tc.tag)
		if ok != tc.ok || version != tc.version {
			t.Errorf("parseVersionTag(%q) = %q/%v, want %q/%v", tc.tag, version, ok, tc.version, tc.ok)
		}
	}

	platforms := []struct {
		name     string
		platform string
	}{
		{"yj-forum-windows-1.2.0.zip", PlatformWindows},
		{"yj-forum-android-1.2.0.apk", PlatformAndroid},
		{"yj-forum-linux-1.2.0.tar.gz", PlatformLinux},
		{"yj-forum-macos-1.2.0.dmg", PlatformMacOS},
		{"setup.exe", PlatformWindows},
		{"app.apk", PlatformAndroid},
		{"latest.json", ""},
		{"checksums.sha256", ""},
	}
	for _, tc := range platforms {
		if got := assetPlatform(tc.name); got != tc.platform {
			t.Errorf("assetPlatform(%q) = %q, want %q", tc.name, got, tc.platform)
		}
	}

	if compareVersions("1.10.0", "1.9.0") <= 0 {
		t.Error("1.10.0 should be greater than 1.9.0")
	}
	if compareVersions("2.0", "2.0.0") != 0 {
		t.Error("2.0 should equal 2.0.0")
	}
	if compareVersions("1.3", "1.3.18") >= 0 {
		t.Error("1.3 should be less than 1.3.18")
	}
}

func TestParsePlatformPrefixedReleaseTag(t *testing.T) {
	raw := []githubRelease{{
		TagName: "Android-V2.1.0",
		Body:    "Android 客户端更新",
		Assets: []githubAsset{{
			Name:               "forum-android-2.1.0.apk",
			Size:               4995195,
			BrowserDownloadURL: "https://github.com/yoyo-ouo/yj-forum-ouo/releases/download/Android-V2.1.0/forum-android-2.1.0.apk",
		}},
	}}
	items := parseReleases(raw)
	if len(items) != 1 {
		t.Fatalf("releases = %d, want 1", len(items))
	}
	got := items[0]
	if got.Version != "2.1.0" || got.Platform != PlatformAndroid {
		t.Fatalf("release = %s/%s, want 2.1.0/android", got.Version, got.Platform)
	}
	if got.Filename != "forum-android-2.1.0.apk" || got.Size != 4995195 {
		t.Fatalf("asset = %+v", got)
	}
}

func TestParseNotes(t *testing.T) {
	notes := parseNotes("- 第一条\n\n* 第二条\n普通行\n")
	want := []string{"第一条", "第二条", "普通行"}
	if fmt.Sprint(notes) != fmt.Sprint(want) {
		t.Fatalf("notes = %#v, want %#v", notes, want)
	}
}
