package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func newRateLimitRouter(key string, maxCount int, window time.Duration) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/x", RateLimit(key, maxCount, window), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	return r
}

func serveN(t *testing.T, r *gin.Engine, n int) int {
	t.Helper()
	code := 0
	for i := 0; i < n; i++ {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/x", nil))
		code = w.Code
	}
	return code
}

// window=300*time.Second 时：前 10 次放行，第 11 次应 429。
func TestRateLimitWindowSeconds(t *testing.T) {
	r := newRateLimitRouter("test_window_seconds", 10, 300*time.Second)
	if code := serveN(t, r, 10); code != http.StatusOK {
		t.Fatalf("前 10 次请求应为 200，实际 %d", code)
	}
	if code := serveN(t, r, 1); code != http.StatusTooManyRequests {
		t.Fatalf("第 11 次请求应为 429，实际 %d", code)
	}
}

// window 误传裸整数（纳秒）时应回退为 1 分钟防御，第 11 次仍应 429。
func TestRateLimitGuardsSubSecondWindow(t *testing.T) {
	r := newRateLimitRouter("test_window_guard", 10, 300)
	if code := serveN(t, r, 10); code != http.StatusOK {
		t.Fatalf("前 10 次请求应为 200，实际 %d", code)
	}
	if code := serveN(t, r, 1); code != http.StatusTooManyRequests {
		t.Fatalf("第 11 次请求应为 429（窗口已回退为 1 分钟），实际 %d", code)
	}
}

// ---- Gzip ----

func newGzipRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Gzip())
	r.GET("/json", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"hello": "gzip"})
	})
	r.GET("/empty", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	r.GET("/sse", func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		_, _ = c.Writer.WriteString("data: hi\n\n")
		c.Writer.Flush()
	})
	return r
}

func requestWithEncoding(r *gin.Engine, path, acceptEncoding string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if acceptEncoding != "" {
		req.Header.Set("Accept-Encoding", acceptEncoding)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// 回归：旧实现在 c.Next() 之前读 Content-Type（此时为空）导致永远不压缩。
func TestGzipCompressesJSON(t *testing.T) {
	r := newGzipRouter()

	w := requestWithEncoding(r, "/json", "gzip, deflate")
	if got := w.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Accept-Encoding 带 gzip 时 JSON 响应应 gzip，实际 Content-Encoding=%q", got)
	}
	if w.Body.Len() == 0 {
		t.Fatal("响应体为空")
	}
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatalf("响应体不是合法 gzip: %v", err)
	}
	defer zr.Close()
	body, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("解压失败: %v", err)
	}
	if got := string(body); got != `{"hello":"gzip"}` {
		t.Fatalf("解压后内容不符，实际 %q", got)
	}
}

// 客户端不支持 gzip 时保持原样，不然浏览器无法解析。
func TestGzipSkipsWhenNotAccepted(t *testing.T) {
	r := newGzipRouter()
	w := requestWithEncoding(r, "/json", "")
	if got := w.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("未声明 Accept-Encoding 时不应压缩，实际 %q", got)
	}
	if !strings.Contains(w.Body.String(), "gzip") {
		t.Fatalf("响应体异常: %q", w.Body.String())
	}
}

// 无 body 的响应（204）必须原样写出状态码，不能因为推迟写头而变 200。
func TestGzipPreservesEmptyStatus(t *testing.T) {
	r := newGzipRouter()
	w := requestWithEncoding(r, "/empty", "gzip")
	if w.Code != http.StatusNoContent {
		t.Fatalf("空响应状态码应为 204，实际 %d", w.Code)
	}
	if got := w.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("空响应不应带 Content-Encoding，实际 %q", got)
	}
}

// SSE 一旦被 gzip 缓冲就失去实时性，必须跳过。
func TestGzipSkipsEventStream(t *testing.T) {
	r := newGzipRouter()
	w := requestWithEncoding(r, "/sse", "gzip")
	if got := w.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("text/event-stream 不应压缩，实际 %q", got)
	}
	if got := w.Body.String(); got != "data: hi\n\n" {
		t.Fatalf("SSE 响应体被改写: %q", got)
	}
}
