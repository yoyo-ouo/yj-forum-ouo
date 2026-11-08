package handler

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/altcha"
	"yj-forum/server/internal/assets/easteregg"
	"yj-forum/server/internal/auth"
	"yj-forum/server/internal/config"
	"yj-forum/server/internal/database"
	"yj-forum/server/internal/email"
	"yj-forum/server/internal/middleware"
	"yj-forum/server/internal/models"
)

// MiscHandler 杂项（投票/Bug/彩蛋/验证码邮件）。
type MiscHandler struct {
	DB       *database.DB
	Cfg      *config.Config
	Mailer   *email.Sender
	Sessions *auth.SessionManager
	Altcha   *altcha.Service // nil 安全：未注入时跳过 ALTCHA 校验
}

func (h *MiscHandler) userFromCookie(c *gin.Context) string {
	if uid := CurrentUser(c); uid != "" {
		return uid
	}
	if token, err := c.Cookie(cookieName); err == nil && token != "" {
		if id, verr := h.Sessions.Validate(c.Request.Context(), token); verr == nil && id != "" {
			return id
		}
	}
	return ""
}

// ---- 验证码邮件 ----

// SendRegisterCode 注册验证码。
func (h *MiscHandler) SendRegisterCode(c *gin.Context) {
	mw := middleware.RateLimit("register_code", 3, 300*time.Second)
	mw(c)
	if c.IsAborted() {
		return
	}
	var req struct {
		Email  string `json:"email" binding:"required"`
		Altcha string `json:"altcha"`
		Grant  string `json:"grant"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if !VerifyRequest(c, h.Altcha, req.Altcha, req.Grant) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "CAPTCHA_REQUIRED"})
		return
	}
	emailAddr := strings.ToLower(strings.TrimSpace(req.Email))
	blocked, err := h.DB.IsEmailBlacklisted(c.Request.Context(), database.NormalizeEmail(emailAddr))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "服务器错误"})
		return
	}
	if blocked {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "邮箱异样"})
		return
	}
	if h.DB.UserExistsByEmail(c.Request.Context(), emailAddr) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "邮箱已被注册"})
		return
	}
	code := genCode(6)
	if err := h.DB.CreateVerifyCode(c.Request.Context(), emailAddr, code, "register", 5); err != nil {
		log.Printf("[CODE] register code insert failed (%s): %v", emailAddr, err)
	}
	h.sendCode(c, "注册验证码", emailAddr, code)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "验证码已发送"})
}

// verifyEmailResendCooldown 同一用户邮箱验证码重发冷却时间。
const verifyEmailResendCooldown = 60 * time.Second

// verifyEmailResendAllowed 上一条未使用验证码是否已过冷却期（last 为空表示从未发送）。
func verifyEmailResendAllowed(last *time.Time, now time.Time) bool {
	if last == nil || last.IsZero() {
		return true
	}
	return now.Sub(*last) >= verifyEmailResendCooldown
}

// SendVerifyEmailCode 邮箱验证码（需登录）。
func (h *MiscHandler) SendVerifyEmailCode(c *gin.Context) {
	uid := h.userFromCookie(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	u, err := h.DB.GetUserByID(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "用户不存在"})
		return
	}
	// 发送侧冷却：60 秒内已发过未使用的验证码则拒绝，避免重复点发或绕过邮件隐私限流。
	last, err := h.DB.LastUnusedVerifyCodeAt(c.Request.Context(), u.Email, "email_verify")
	if err != nil {
		log.Printf("[CODE] email_verify last query failed (%s): %v", u.Email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "服务器错误"})
		return
	}
	if !verifyEmailResendAllowed(last, time.Now()) {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "发送太频繁，请稍后再试"})
		return
	}
	code := genCode(6)
	if err := h.DB.CreateVerifyCode(c.Request.Context(), u.Email, code, "email_verify", 5); err != nil {
		log.Printf("[CODE] email_verify code insert failed (%s): %v", u.Email, err)
	}
	h.sendCode(c, "邮箱验证码", u.Email, code)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "验证码已发送"})
}

// SendResetLink 发送密码重置链接（替代验证码流程；账号是否存在不对外区分）。
func (h *MiscHandler) SendResetLink(c *gin.Context) {
	var req struct {
		Email  string `json:"email" binding:"required"`
		Altcha string `json:"altcha"`
		Grant  string `json:"grant"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if !VerifyRequest(c, h.Altcha, req.Altcha, req.Grant) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "CAPTCHA_REQUIRED"})
		return
	}
	emailAddr := strings.ToLower(strings.TrimSpace(req.Email))
	allowed, err := h.DB.TryAcquireActionLimit(c.Request.Context(), "password_reset", emailAddr, 3600)
	if err != nil {
		log.Printf("[RESET] 操作限流检查失败 (%s): %v", emailAddr, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "服务器错误"})
		return
	}
	if !allowed {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "请求过于频繁，请 1 小时后再试"})
		return
	}
	if userID, uerr := h.DB.GetUserIDByEmail(c.Request.Context(), emailAddr); uerr == nil {
		if token, terr := h.DB.CreateResetToken(c.Request.Context(), userID); terr != nil {
			log.Printf("[RESET] 重置 token 创建失败 (%s): %v", emailAddr, terr)
		} else {
			link := normalizeBaseURL(h.Cfg.PublicBaseURL) + "/reset-password?token=" + token
			plain := "我们收到了你的密码重置请求，请打开以下链接设置新密码：\n" + link + "\n链接 10 分钟内有效，最多可打开 3 次。\n若非本人操作请忽略本邮件。"
			htmlBody := email.BuildHTML("重置密码", "重置你的密码",
				[]string{"我们收到了你的密码重置请求，请点击下方按钮设置新密码：", "链接 10 分钟内有效，最多可打开 3 次。"},
				"重置密码", link, "若非本人操作请忽略本邮件。")
			go func() {
				_, _ = h.Mailer.Send("【妖精论坛】重置密码", plain, []string{emailAddr}, htmlBody)
			}()
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "重置链接已发送（若邮箱存在）"})
}

// ValidateResetToken 打开重置链接时校验并占用一次访问（每个链接最多 3 次）。
func (h *MiscHandler) ValidateResetToken(c *gin.Context) {
	token := strings.TrimSpace(c.Query("token"))
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "链接无效或已失效，请重新申请重置"})
		return
	}
	userID, err := h.DB.ConsumeResetTokenVisit(c.Request.Context(), token)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "链接无效或已失效，请重新申请重置"})
		return
	}
	u, err := h.DB.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "链接无效或已失效，请重新申请重置"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"email": maskEmail(u.Email)}})
}

// ResetPasswordByToken 凭链接 token 设置新密码（强度校验与注册一致）。
func (h *MiscHandler) ResetPasswordByToken(c *gin.Context) {
	var req struct {
		Token    string `json:"token" binding:"required"`
		Password string `json:"password" binding:"required"`
		Altcha   string `json:"altcha"`
		Grant    string `json:"grant"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if !VerifyRequest(c, h.Altcha, req.Altcha, req.Grant) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "CAPTCHA_REQUIRED"})
		return
	}
	if len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "密码至少8位"})
		return
	}
	if !hasLetterAndDigit(req.Password) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "密码需包含字母和数字"})
		return
	}
	userID, err := h.DB.GetResetTokenForSubmit(c.Request.Context(), strings.TrimSpace(req.Token))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "链接无效或已失效，请重新申请重置"})
		return
	}
	hash, err := bcryptHash(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "服务器错误"})
		return
	}
	if err := h.DB.UpdateUserProfile(c.Request.Context(), userID, map[string]any{"password": hash}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "重置失败"})
		return
	}
	if err := h.DB.MarkUserResetTokensUsed(c.Request.Context(), userID); err != nil {
		log.Printf("[RESET] 重置 token 核销失败 (uid=%s): %v", userID, err)
	}
	if err := h.Sessions.DeleteByUserID(c.Request.Context(), userID); err != nil {
		log.Printf("[RESET] 重置后会话清理失败 (uid=%s): %v", userID, err)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "密码重置成功，请使用新密码登录"})
}

// sendCodeMail 异步发送 6 位验证码邮件（注册/换绑等通用）。
func sendCodeMail(mailer *email.Sender, label, to, code string) {
	plain := fmt.Sprintf("【妖精论坛】%s：%s，5分钟内有效。", label, code)
	htmlBody := email.BuildHTML(label, "你的验证码", []string{"请在 5 分钟内输入以下验证码：", `<div style="font-size:32px;font-weight:700;color:#4f46e5;text-align:center;letter-spacing:8px">` + code + `</div>`}, "", "", "")
	go func() {
		_, _ = mailer.Send("【妖精论坛】"+label, plain, []string{to}, htmlBody)
	}()
}

func (h *MiscHandler) sendCode(c *gin.Context, label, to, code string) {
	sendCodeMail(h.Mailer, label, to, code)
}

// ---- 验证码校验（注册/邮箱/重置）----

// VerifyCodeEmail 邮箱验证（code 通道）。
func (h *MiscHandler) VerifyCodeEmail(c *gin.Context) {
	uid := h.userFromCookie(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	u, err := h.DB.GetUserByID(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "用户不存在"})
		return
	}
	ok, err := verifyCodeWithLimit(c.Request.Context(), h.DB, u.Email, req.Code, "email_verify")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "服务器错误"})
		return
	}
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "验证码错误或已过期"})
		return
	}
	_ = h.DB.UpdateUserEmailVerified(c.Request.Context(), uid)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "邮箱验证成功"})
}

// ---- 工具 ----

// normalizeBaseURL 规整站点对外地址：已带 http(s) 前缀直接用；localhost/127./[::1] 补 http://，其余补 https://。
func normalizeBaseURL(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return s
	}
	s = strings.TrimRight(s, "/")
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return s
	}
	if strings.HasPrefix(lower, "localhost") || strings.HasPrefix(lower, "127.") || strings.HasPrefix(lower, "[::1]") {
		return "http://" + s
	}
	return "https://" + s
}

// maskEmail 邮箱脱敏：保留首字符与域名（a***@example.com）。
func maskEmail(addr string) string {
	at := strings.LastIndexByte(addr, '@')
	if at <= 0 {
		return "***"
	}
	local := []rune(addr[:at])
	if len(local) == 0 {
		return "***" + addr[at:]
	}
	return string(local[:1]) + "***" + addr[at:]
}

func genCode(n int) string {
	const digits = "0123456789"
	var sb strings.Builder
	for i := 0; i < n; i++ {
		nb, _ := rand.Int(rand.Reader, big.NewInt(10))
		sb.WriteByte(digits[nb.Int64()])
	}
	return sb.String()
}

func bcryptHash(pwd string) (string, error) {
	return auth.HashPassword(pwd)
}

type voteReq struct {
	Choice string `json:"choice" binding:"required"`
}

// VoteVersion 版本投票。
func (h *MiscHandler) VoteVersion(c *gin.Context) {
	var req voteReq
	if err := c.ShouldBindJSON(&req); err != nil || (req.Choice != "v1" && req.Choice != "v2") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	uid := h.userFromCookie(c)
	var voterKey string
	if uid != "" {
		voterKey = "u:" + uid
	} else {
		voterKey = "ip:" + c.ClientIP()
	}
	var voterID, voterName string
	if uid != "" {
		if u, err := h.DB.GetUserByID(c.Request.Context(), uid); err == nil {
			voterID, voterName = u.ID, u.Name
		}
	}
	if err := h.DB.VoteVersion(c.Request.Context(), voterKey, req.Choice, voterID, voterName); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "投票失败"})
		return
	}
	stats, _ := h.DB.GetVersionVoteStats(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "投票成功", "stats": stats})
}

// VoteVersionStats 投票统计。
func (h *MiscHandler) VoteVersionStats(c *gin.Context) {
	stats, _ := h.DB.GetVersionVoteStats(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"success": true, "stats": stats})
}

// ---- Bug 举报 ----

type bugReq struct {
	Title   string `json:"title" binding:"required"`
	Detail  string `json:"detail" binding:"required"`
	Steps   string `json:"steps"`
	Contact string `json:"contact"`
	PageURL string `json:"page_url"`
	Altcha  string `json:"altcha"`
	Grant   string `json:"grant"`
}

// ReportBug 提交 Bug（游客也可）。
func (h *MiscHandler) ReportBug(c *gin.Context) {
	var req bugReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if !VerifyRequest(c, h.Altcha, req.Altcha, req.Grant) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "CAPTCHA_REQUIRED"})
		return
	}
	if len([]rune(req.Title)) > 200 || len([]rune(req.Detail)) > 5000 || len([]rune(req.Steps)) > 3000 || len([]rune(req.Contact)) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "内容超长"})
		return
	}
	uid := h.userFromCookie(c)
	var reporterName string
	if uid != "" {
		if u, err := h.DB.GetUserByID(c.Request.Context(), uid); err == nil {
			reporterName = u.Name
		}
	}
	id, err := h.DB.ReportBug(c.Request.Context(), req.Title, req.Detail, req.Steps, req.Contact, uid, reporterName, c.GetHeader("User-Agent"), req.PageURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "提交失败"})
		return
	}
	// 通知管理员（HTML 邮件中对用户可控片段转义，防注入）
	go func() {
		plain := "Bug 报告 #" + fmt.Sprintf("%d", id) + "\n标题: " + req.Title + "\n详情: " + req.Detail
		htmlBody := email.BuildHTML("Bug 报告", "收到新的 Bug 报告", []string{"标题: " + html.EscapeString(req.Title), "详情: " + html.EscapeString(req.Detail), "提交人: " + html.EscapeString(reporterName)}, "", "", "")
		_, _ = h.Mailer.Send("【妖精论坛】Bug 报告 #"+fmt.Sprintf("%d", id), plain, []string{h.Cfg.ReceiverAll}, htmlBody)
	}()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Bug 提交成功", "id": id})
}

// ---- Bug 反馈公开读取（脱敏）----

// ListBugReports 反馈列表（公开；status 可选过滤；不含提交人信息）。
func (h *MiscHandler) ListBugReports(c *gin.Context) {
	var status *int
	if s := strings.TrimSpace(c.Query("status")); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 || n > 3 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
			return
		}
		status = &n
	}
	page, pageSize := parsePageWithDefault(c, 10)
	if pageSize > 50 {
		pageSize = 10
	}
	items, total, hasMore, err := h.DB.ListBugReports(c.Request.Context(), status, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"items": items, "total": total, "page": page, "page_size": pageSize, "has_more": hasMore,
	}})
}

// BugReportStats 反馈状态统计（公开；0/1/2/3 四态均返回）。
func (h *MiscHandler) BugReportStats(c *gin.Context) {
	stats, err := h.DB.GetBugReportStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"stats": stats}})
}

// BugReportDetail 反馈详情与状态日志（公开；不存在 404）。
func (h *MiscHandler) BugReportDetail(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "反馈不存在"})
		return
	}
	report, logs, err := h.DB.GetBugReportDetail(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
		return
	}
	if report == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "反馈不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"report": report, "logs": logs}})
}

// ---- 彩蛋 ----

// eggEntry 彩蛋响应：Kind=static 为内置彩蛋，Kind=quote 为角色设定语录。
type eggEntry struct {
	ID   string `json:"ID"`
	Name string `json:"Name"`
	Text string `json:"Text"`
	Kind string `json:"Kind"`
}

var (
	eggQuoteCacheMu     sync.Mutex
	eggQuoteCacheAt     time.Time
	eggQuoteCacheFailAt time.Time
	eggQuoteCacheData   []models.CharacterEggQuote
)

// eggQuoteCacheTTL 语录池进程内缓存：避免每次点彩蛋都查库。
const eggQuoteCacheTTL = 60 * time.Second

// loadCharacterEggQuotes 读取参与彩蛋展示的设定语录（带 60s 缓存；失败时返回旧缓存）。
func loadCharacterEggQuotes(db *database.DB) []models.CharacterEggQuote {
	if db == nil {
		return nil
	}
	eggQuoteCacheMu.Lock()
	defer eggQuoteCacheMu.Unlock()
	if !eggQuoteCacheAt.IsZero() && time.Since(eggQuoteCacheAt) < eggQuoteCacheTTL {
		return eggQuoteCacheData
	}
	// 失败后 10s 内不再打库（负缓存），避免 DB 抖动时每个请求都串行重试
	if !eggQuoteCacheFailAt.IsZero() && time.Since(eggQuoteCacheFailAt) < 10*time.Second {
		return eggQuoteCacheData
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	rows, err := db.ListCharacterEggQuotes(ctx)
	if err != nil {
		eggQuoteCacheFailAt = time.Now()
		return eggQuoteCacheData
	}
	eggQuoteCacheFailAt = time.Time{}
	eggQuoteCacheData = rows
	eggQuoteCacheAt = time.Now()
	return rows
}

// EasterEgg 随机彩蛋：静态彩蛋与角色语录合并为一个池，等概率抽取。
func (h *MiscHandler) EasterEgg(c *gin.Context) {
	// 默认使用随二进制内置的数据；EASTER_EGG_PATH 非空时可覆盖（方便运营临时替换）。
	data := easteregg.JSON()
	if p := strings.TrimSpace(h.Cfg.EasterEggPath); p != "" {
		if b, err := os.ReadFile(p); err == nil {
			data = b
		} else {
			log.Printf("[EASTER_EGG] 覆盖文件读取失败，回退内置数据 path=%s err=%v", p, err)
		}
	}
	var static []eggEntry
	if err := json.Unmarshal(data, &static); err != nil {
		log.Printf("[EASTER_EGG] 内置数据解析失败: %v", err)
	}
	pool := make([]eggEntry, 0, len(static)+16)
	for _, e := range static {
		e.Kind = "static"
		pool = append(pool, e)
	}
	for _, q := range loadCharacterEggQuotes(h.DB) {
		if strings.TrimSpace(q.Text) == "" || strings.TrimSpace(q.Name) == "" {
			continue
		}
		pool = append(pool, eggEntry{ID: "Q" + q.SheetID, Name: q.Name, Text: q.Text, Kind: "quote"})
	}
	if len(pool) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "彩蛋不存在"})
		return
	}
	n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(pool))))
	c.JSON(http.StatusOK, pool[n.Int64()])
}

// VerifyToken 邮箱验证 token 消费（verify-email 页）。
func (h *MiscHandler) VerifyToken(c *gin.Context) {
	token := c.Query("token")
	// 仅支持 email_verify：避免通过 type 参数消费其他类型（如 password_reset）的令牌
	tokenType := c.DefaultQuery("type", "email_verify")
	if tokenType != "email_verify" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "不支持的验证类型"})
		return
	}
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "缺少 token"})
		return
	}
	userID, err := h.DB.GetVerifyToken(c.Request.Context(), token, tokenType)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "验证链接无效或已过期"})
		return
	}
	_ = h.DB.DeleteVerifyToken(c.Request.Context(), token)
	_ = h.DB.UpdateUserEmailVerified(c.Request.Context(), userID)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "邮箱验证成功"})
}
