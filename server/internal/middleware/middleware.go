// Package middleware 提供 Gin 中间件（CORS/CSRF/限流/安全头/压缩/日志）。
package middleware

import (
	"compress/gzip"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// ---- 限流 ----

type rateEntry struct {
	times []time.Time
}

var (
	rateMu      sync.Mutex
	rateStore   = map[string]*rateEntry{}
	lastCleanup = time.Now()

	// rateLimitBypass 基准测试模式：跳过 IP 限流（仅当 BENCH_DEBUG 且非生产时开启）。
	rateLimitBypass atomic.Bool
)

// SetRateLimitBypass 开启/关闭 IP 限流旁路（仅供基准测试调用）。
func SetRateLimitBypass(on bool) { rateLimitBypass.Store(on) }

// RateLimit 简易速率限制（key 维度 + 客户端 IP）。
// 返回 true 表示超限（应返回 429）。
// window 必须传 time.Duration（如 300*time.Second）；小于 1 秒的窗口一律视为误传裸整数，回退为 1 分钟防御。
func RateLimit(key string, maxCount int, window time.Duration) gin.HandlerFunc {
	if window < time.Second {
		window = time.Minute
	}
	return func(c *gin.Context) {
		if rateLimitBypass.Load() {
			c.Next()
			return
		}
		keyID := c.ClientIP()
		// 已认证的请求按用户分桶（AuthRequired 在 RateLimit 之前时生效），避免 NAT 下互相挤占
		if uid, ok := c.Get("userID"); ok {
			if s, ok := uid.(string); ok && s != "" {
				keyID = "u:" + s
			}
		}
		rk := key + ":" + keyID
		rateMu.Lock()
		now := time.Now()
		ent, ok := rateStore[rk]
		if !ok {
			ent = &rateEntry{}
			rateStore[rk] = ent
		}
		// 过滤窗口外
		cutoff := now.Add(-window)
		kept := ent.times[:0]
		for _, t := range ent.times {
			if t.After(cutoff) {
				kept = append(kept, t)
			}
		}
		ent.times = kept
		if len(ent.times) >= maxCount {
			rateMu.Unlock()
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "请求过于频繁，请稍后再试"})
			return
		}
		ent.times = append(ent.times, now)
		// 定期清理
		if len(rateStore) > 5000 || now.Sub(lastCleanup) > 10*time.Minute {
			lastCleanup = now
			for k, item := range rateStore {
				stale := time.Now().Add(-2 * window)
				hasFresh := false
				for _, t := range item.times {
					if t.After(stale) {
						hasFresh = true
						break
					}
				}
				if !hasFresh {
					delete(rateStore, k)
				}
			}
		}
		rateMu.Unlock()
		c.Next()
	}
}

// ---- CSRF ----

// CSRF 校验 Origin/Referer（对齐 legacy main.py csrf_protect）。
func CSRF(allowedOrigins []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		method := c.Request.Method
		if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
			c.Next()
			return
		}
		origin := c.GetHeader("Origin")
		referer := c.GetHeader("Referer")
		if isAllowed(origin, allowedOrigins, c) || isAllowed(referer, allowedOrigins, c) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "message": "跨站请求已被拦截"})
	}
}

func isAllowed(rawURL string, allowedOrigins []string, c *gin.Context) bool {
	if rawURL == "" {
		return false
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return false
	}
	// 同源：Host 必须完全相等（不能用前缀比较，否则 https://yjlt.top.evil.com 会绕过）
	host := c.Request.Host
	if fwd := c.GetHeader("X-Forwarded-Host"); fwd != "" {
		host = fwd
	}
	if strings.EqualFold(u.Host, host) {
		return true
	}
	// 白名单：scheme + host 完全相等
	for _, ao := range allowedOrigins {
		a, err := url.Parse(strings.TrimRight(ao, "/"))
		if err != nil || a.Host == "" {
			continue
		}
		if strings.EqualFold(u.Scheme, a.Scheme) && strings.EqualFold(u.Host, a.Host) {
			return true
		}
	}
	return false
}

// ---- CORS ----

// CORS 白名单 CORS。allowAll 仅建议 dev 使用；生产必须显式配置 origins。
func CORS(allowedOrigins []string, allowAll bool) gin.HandlerFunc {
	originSet := map[string]bool{}
	for _, o := range allowedOrigins {
		originSet[strings.TrimRight(o, "/")] = true
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Header("Vary", "Origin")
		}
		if origin != "" && (allowAll || originSet[strings.TrimRight(origin, "/")]) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, Last-Event-ID")
			c.Header("Access-Control-Max-Age", "86400")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// ---- 安全响应头 + gzip ----

// SecurityHeaders 安全头（对齐 legacy performance_optimize 安全部分）。
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("X-Content-Type-Options", "nosniff")
		c.Writer.Header().Set("X-Frame-Options", "SAMEORIGIN")
		c.Writer.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Writer.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()")
		c.Writer.Header().Set("X-XSS-Protection", "1; mode=block")
		if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
			c.Writer.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Next()
	}
}

// gzipEligible 该 Content-Type 是否值得压缩。
// SSE（text/event-stream）必须排除：压缩会缓冲事件，实时推送直接失效。
func gzipEligible(contentType string) bool {
	if contentType == "" || strings.Contains(contentType, "text/event-stream") {
		return false
	}
	return strings.Contains(contentType, "text/") ||
		strings.Contains(contentType, "application/json") ||
		strings.Contains(contentType, "application/javascript") ||
		strings.Contains(contentType, "image/svg+xml")
}

// gzipWriter 延迟决定是否压缩的 ResponseWriter。
//
// 为什么必须延迟：Content-Type 由 handler 在写响应时才设置（c.JSON → writeContentType），
// 中间件在 c.Next() 之前读 Header 时它还是空的——旧实现据此判断，于是永远不压缩。
// 这里把「写响应头」推迟到第一次 Write（此时 Content-Type 已就绪）；
// 无 body 的响应（204/304/重定向）由 Gzip 尾部 finish() 兜底写出。
type gzipWriter struct {
	gin.ResponseWriter
	acceptGzip  bool
	decided     bool
	compress    bool
	status      int
	wroteHeader bool
	gz          *gzip.Writer
}

// Status 返回待写出的状态码（gin 的 Logger 在 c.Next() 之后读取）。
func (g *gzipWriter) Status() int {
	if g.status != 0 {
		return g.status
	}
	return g.ResponseWriter.Status()
}

// Written 是否已向后端写出响应头。
func (g *gzipWriter) Written() bool {
	return g.wroteHeader || g.ResponseWriter.Written()
}

// WriteHeader 暂存状态码，等第一次 Write 时连同 Content-Encoding 一起写出。
func (g *gzipWriter) WriteHeader(code int) {
	if g.decided {
		g.ResponseWriter.WriteHeader(code)
		return
	}
	g.status = code
}

// WriteHeaderNow gin 在渲染前调用；此时 body 还没写，不能提前落盘响应头。
func (g *gzipWriter) WriteHeaderNow() {
	if g.wroteHeader {
		g.ResponseWriter.WriteHeaderNow()
		return
	}
	if g.status == 0 {
		g.status = g.ResponseWriter.Status()
	}
}

// decide 首次写 body 时确定是否压缩，并写出响应头。
func (g *gzipWriter) decide() {
	if g.decided {
		return
	}
	g.decided = true
	if g.acceptGzip && gzipEligible(g.ResponseWriter.Header().Get("Content-Type")) {
		h := g.ResponseWriter.Header()
		h.Set("Content-Encoding", "gzip")
		h.Add("Vary", "Accept-Encoding")
		// 压缩后长度未知，必须丢掉（否则客户端会截断/挂起）
		h.Del("Content-Length")
		g.compress = true
		g.gz = gzip.NewWriter(g.ResponseWriter)
	}
	if g.status == 0 {
		g.status = g.ResponseWriter.Status()
	}
	g.ResponseWriter.WriteHeader(g.status)
	g.wroteHeader = true
}

func (g *gzipWriter) Write(data []byte) (int, error) {
	g.decide()
	if g.compress {
		return g.gz.Write(data)
	}
	return g.ResponseWriter.Write(data)
}

func (g *gzipWriter) WriteString(s string) (int, error) {
	g.decide()
	if g.compress {
		return g.gz.Write([]byte(s))
	}
	return g.ResponseWriter.WriteString(s)
}

// Flush 先落定压缩决策，再透传 flush（避免流式响应被 gzip 缓冲）。
func (g *gzipWriter) Flush() {
	g.decide()
	if g.compress {
		_ = g.gz.Flush()
	}
	g.ResponseWriter.Flush()
}

// finish 收尾：保证响应头一定写出（含 204/304 等无 body 情况）并关闭 gzip 流。
func (g *gzipWriter) finish() {
	g.decide()
	if g.compress {
		_ = g.gz.Close()
	}
}

// Gzip 压缩中间件（JSON/文本响应启用 gzip，SSE 与 HEAD 除外）。
func Gzip() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodHead || !strings.Contains(c.GetHeader("Accept-Encoding"), "gzip") {
			c.Next()
			return
		}
		gw := &gzipWriter{ResponseWriter: c.Writer, acceptGzip: true}
		c.Writer = gw
		c.Next()
		gw.finish()
	}
}

// ---- 日志 ----

// Logger 请求日志。
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		dur := time.Since(start)
		if dur > 200*time.Millisecond {
			log.Printf("[HTTP] %s %s %d %s", c.Request.Method, c.Request.URL.Path, c.Writer.Status(), dur)
		}
	}
}
