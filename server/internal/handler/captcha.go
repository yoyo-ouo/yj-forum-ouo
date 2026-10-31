package handler

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/altcha"
	"yj-forum/server/internal/middleware"
)

// CaptchaHandler ALTCHA v2 公开端点。
type CaptchaHandler struct {
	Altcha *altcha.Service
}

// NewCaptchaHandler 创建 CaptchaHandler。
func NewCaptchaHandler(svc *altcha.Service) *CaptchaHandler {
	return &CaptchaHandler{Altcha: svc}
}

// Config GET /captcha/config。
func (h *CaptchaHandler) Config(c *gin.Context) {
	enabled := h != nil && h.Altcha != nil && h.Altcha.Enabled()
	appEnabled := h != nil && h.Altcha != nil && h.Altcha.AppEnabled()
	algorithm, cost := altcha.DefaultAlgorithm, altcha.DefaultCost
	if h != nil && h.Altcha != nil {
		algorithm, cost = h.Altcha.Algorithm(), h.Altcha.Cost()
	}
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"enabled":     enabled,
		"app_enabled": appEnabled,
		"algorithm":   algorithm,
		"cost":        cost,
	})
}

// Challenge GET /captcha/challenge，直接返回 ALTCHA 官方 Challenge JSON（不包 success）。
func (h *CaptchaHandler) Challenge(c *gin.Context) {
	if !h.captchaEnabled() {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "CAPTCHA_DISABLED"})
		return
	}
	challenge, err := h.Altcha.Challenge(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "CAPTCHA_UNAVAILABLE"})
		return
	}
	c.JSON(http.StatusOK, challenge)
}

// Verify POST /captcha/verify，body {altcha:"<base64 payload>"}，成功返回一次性 grant。
func (h *CaptchaHandler) Verify(c *gin.Context) {
	if !h.captchaEnabled() {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "CAPTCHA_DISABLED"})
		return
	}
	var req struct {
		Altcha string `json:"altcha"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Altcha) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "CAPTCHA_REQUIRED"})
		return
	}
	ok, err := h.Altcha.Verify(c.Request.Context(), req.Altcha)
	if err != nil || !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "CAPTCHA_REQUIRED"})
		return
	}
	grant, err := h.Altcha.Grant(c.ClientIP())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "CAPTCHA_UNAVAILABLE"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"grant":      grant,
		"expires_in": int(altcha.GrantTTL.Seconds()),
	})
}

// AppChallenge GET /captcha/app/challenge：APP 专用挑战（零 PoW，仅需一次 HMAC）。
// 通道未开启（未配置 ALTCHA_APP_SECRET）时返回 404 CAPTCHA_DISABLED，客户端据此回退 ALTCHA。
func (h *CaptchaHandler) AppChallenge(c *gin.Context) {
	if h == nil || h.Altcha == nil || !h.Altcha.AppEnabled() {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "CAPTCHA_DISABLED"})
		return
	}
	challenge, timestamp, err := h.Altcha.AppChallenge()
	if err != nil {
		log.Printf("[ALTCHA] app challenge failed: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "CAPTCHA_UNAVAILABLE"})
		return
	}
	// 挑战是一次性 nonce，任何缓存都会让第二个客户端拿到已被消费的 nonce。
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"challenge":  challenge,
		"timestamp":  timestamp,
		"expires_in": int(altcha.AppChallengeTTL.Seconds()),
	})
}

// AppVerify POST /captcha/app/verify，body {challenge,timestamp,signature}，成功返回一次性 grant。
// signature = hex(HMAC-SHA256(ALTCHA_APP_SECRET, "app-captcha:v1:<challenge>:<timestamp>"))。
func (h *CaptchaHandler) AppVerify(c *gin.Context) {
	if h == nil || h.Altcha == nil || !h.Altcha.AppEnabled() {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "CAPTCHA_DISABLED"})
		return
	}
	var req struct {
		Challenge string `json:"challenge"`
		Timestamp int64  `json:"timestamp"`
		Signature string `json:"signature"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "CAPTCHA_REQUIRED"})
		return
	}
	ok, err := h.Altcha.VerifyAppProof(c.Request.Context(), req.Challenge, req.Timestamp, req.Signature)
	if err != nil || !ok {
		if err != nil {
			// 只记错误类型，不记签名/密钥；用于发现“密钥不一致/存储故障”这类静默失效。
			log.Printf("[ALTCHA] app verify error: %v", err)
		}
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "CAPTCHA_REQUIRED"})
		return
	}
	grant, err := h.Altcha.Grant(c.ClientIP())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "CAPTCHA_UNAVAILABLE"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"grant":      grant,
		"expires_in": int(altcha.GrantTTL.Seconds()),
	})
}

// VerifyRequest 校验受保护端点携带的 ALTCHA proof（altcha 或 grant）。
// ALTCHA 未启用（或未注入 service）时返回 true，保持原有行为；启用后任何
// 缺失/无效/校验异常都返回 false（fail-closed）。
func VerifyRequest(c *gin.Context, svc *altcha.Service, altchaPayload, grant string) bool {
	if svc == nil || !svc.Enabled() {
		return true
	}
	if g := strings.TrimSpace(grant); g != "" && svc.VerifyGrant(g, c.ClientIP()) {
		return true
	}
	if p := strings.TrimSpace(altchaPayload); p != "" {
		ok, err := svc.Verify(c.Request.Context(), p)
		return err == nil && ok
	}
	return false
}

// VerifyRequest 方法形式，便于 CaptchaHandler 自身复用。
func (h *CaptchaHandler) VerifyRequest(c *gin.Context, altchaPayload, grant string) bool {
	if h == nil {
		return VerifyRequest(c, nil, altchaPayload, grant)
	}
	return VerifyRequest(c, h.Altcha, altchaPayload, grant)
}

func (h *CaptchaHandler) captchaEnabled() bool {
	return h != nil && h.Altcha != nil && h.Altcha.Enabled()
}

// RegisterCaptchaRoutes 注册 /captcha/* 路由。
func RegisterCaptchaRoutes(api *gin.RouterGroup, h *CaptchaHandler) {
	if h == nil {
		h = &CaptchaHandler{}
	}
	api.GET("/captcha/config", h.Config)
	api.GET("/captcha/challenge", h.Challenge)
	api.POST("/captcha/verify", h.Verify)
	// APP 专用零 PoW 通道：挑战/校验都限流（verified 会写一行 altcha_used，必须控量），
	// 正常客户端 5 分钟内至多几次，额度按 CGNAT 共享 IP 留余量。
	api.GET("/captcha/app/challenge", middleware.RateLimit("captcha_app_challenge", 30, time.Minute), h.AppChallenge)
	api.POST("/captcha/app/verify", middleware.RateLimit("captcha_app_verify", 12, time.Minute), h.AppVerify)
}
