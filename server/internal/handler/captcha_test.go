package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	altchalib "github.com/altcha-org/altcha-lib-go/v2"
	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/altcha"
)

// appTestSecret 测试用 APP 通道密钥；长度与隔离校验在 main.go 的启动检查里，service 构造不校验。
const appTestSecret = "test-app-secret"

func newCaptchaTestRouter(svc *altcha.Service) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterCaptchaRoutes(r.Group("/ov2/api"), NewCaptchaHandler(svc))
	return r
}

func doCaptchaJSON(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	return doCaptchaJSONFrom(r, method, path, body, "")
}

// testIPSeq 测试 IP 序号：限流按 IP 分桶，同进程内多次执行（如 -count=N）需要不同分桶。
var testIPSeq atomic.Int64

// nextTestIP 返回一个尚未使用过的测试客户端地址（198.18.0.0/15 为基准测试保留网段）。
func nextTestIP() string {
	n := testIPSeq.Add(1)
	return fmt.Sprintf("198.18.%d.%d:1234", (n/250)%250, n%250+1)
}

// doCaptchaJSONFrom 指定 RemoteAddr（限流按 IP 分桶，测试之间必须用不同 IP 隔开）。
func doCaptchaJSONFrom(r *gin.Engine, method, path, body, remoteAddr string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// testAppSignature 按协议独立计算签名：hex(HMAC-SHA256(secret, "app-captcha:v1:<challenge>:<timestamp>"))。
// 故意不复用服务端私有函数——签名域一旦被改动，这里会立即失败。
func testAppSignature(secret, challenge string, timestamp int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte("app-captcha:v1:" + challenge + ":" + strconv.FormatInt(timestamp, 10)))
	return hex.EncodeToString(mac.Sum(nil))
}

func TestCaptchaConfigAndChallengeRoutes(t *testing.T) {
	svc := altcha.New(nil, altcha.Config{Enabled: true, HMACKey: "test-key", Cost: 10, Expires: time.Minute})
	r := newCaptchaTestRouter(svc)

	w := doCaptchaJSON(r, http.MethodGet, "/ov2/api/captcha/config", "")
	if w.Code != http.StatusOK {
		t.Fatalf("config status = %d, want 200", w.Code)
	}
	var cfgResp struct {
		Success   bool   `json:"success"`
		Enabled   bool   `json:"enabled"`
		Algorithm string `json:"algorithm"`
		Cost      int    `json:"cost"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &cfgResp); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if !cfgResp.Success || !cfgResp.Enabled || cfgResp.Algorithm != altcha.DefaultAlgorithm || cfgResp.Cost != 10 {
		t.Fatalf("unexpected config: %+v", cfgResp)
	}

	w = doCaptchaJSON(r, http.MethodGet, "/ov2/api/captcha/challenge", "")
	if w.Code != http.StatusOK {
		t.Fatalf("challenge status = %d, want 200", w.Code)
	}
	var challenge altchalib.Challenge
	if err := json.Unmarshal(w.Body.Bytes(), &challenge); err != nil {
		t.Fatalf("decode challenge: %v", err)
	}
	if challenge.Parameters.Nonce == "" || challenge.Signature == "" {
		t.Fatalf("unexpected challenge: %+v", challenge)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("standard challenge Cache-Control = %q, want no-store", got)
	}
}

func TestCaptchaRoutesDisabled(t *testing.T) {
	r := newCaptchaTestRouter(altcha.New(nil, altcha.Config{Enabled: false}))

	w := doCaptchaJSON(r, http.MethodGet, "/ov2/api/captcha/config", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"enabled":false`) {
		t.Fatalf("disabled config = %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"app_enabled":false`) {
		t.Fatalf("disabled config must report app_enabled=false: %s", w.Body.String())
	}
	if w := doCaptchaJSON(r, http.MethodGet, "/ov2/api/captcha/challenge", ""); w.Code != http.StatusNotFound {
		t.Fatalf("disabled challenge status = %d, want 404", w.Code)
	}
	if w := doCaptchaJSON(r, http.MethodPost, "/ov2/api/captcha/verify", `{"altcha":"x"}`); w.Code != http.StatusNotFound {
		t.Fatalf("disabled verify status = %d, want 404", w.Code)
	}
}

func TestCaptchaAppRoutesDisabledWithoutSecret(t *testing.T) {
	r := newCaptchaTestRouter(altcha.New(nil, altcha.Config{Enabled: true, HMACKey: "test-key", AppSecret: ""}))

	if w := doCaptchaJSON(r, http.MethodGet, "/ov2/api/captcha/app/challenge", ""); w.Code != http.StatusNotFound {
		t.Fatalf("app challenge without secret = %d, want 404", w.Code)
	}
	if w := doCaptchaJSON(r, http.MethodPost, "/ov2/api/captcha/app/verify",
		`{"challenge":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","timestamp":1700000000,"signature":"x"}`); w.Code != http.StatusNotFound {
		t.Fatalf("app verify without secret = %d, want 404", w.Code)
	}
	w := doCaptchaJSON(r, http.MethodGet, "/ov2/api/captcha/config", "")
	if !strings.Contains(w.Body.String(), `"app_enabled":false`) {
		t.Fatalf("config must report app_enabled=false: %s", w.Body.String())
	}
}

func TestCaptchaAppChallengeRoute(t *testing.T) {
	r := newCaptchaTestRouter(altcha.New(nil, altcha.Config{Enabled: true, HMACKey: "test-key", AppSecret: "app-secret"}))

	w := doCaptchaJSON(r, http.MethodGet, "/ov2/api/captcha/app/challenge", "")
	if w.Code != http.StatusOK {
		t.Fatalf("app challenge status = %d, want 200 (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Success   bool   `json:"success"`
		Challenge string `json:"challenge"`
		Timestamp int64  `json:"timestamp"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode app challenge: %v", err)
	}
	if !resp.Success || len(resp.Challenge) != 32 || resp.Timestamp <= 0 || resp.ExpiresIn != int(altcha.AppChallengeTTL.Seconds()) {
		t.Fatalf("unexpected app challenge: %+v", resp)
	}
	cfg := doCaptchaJSON(r, http.MethodGet, "/ov2/api/captcha/config", "")
	if !strings.Contains(cfg.Body.String(), `"app_enabled":true`) {
		t.Fatalf("config must report app_enabled=true: %s", cfg.Body.String())
	}
}

func TestCaptchaAppVerifyRejectsBadSignature(t *testing.T) {
	r := newCaptchaTestRouter(altcha.New(nil, altcha.Config{Enabled: true, HMACKey: "test-key", AppSecret: "app-secret"}))

	body := `{"challenge":"` + strings.Repeat("a", 32) + `","timestamp":1700000000,"signature":"deadbeef"}`
	w := doCaptchaJSON(r, http.MethodPost, "/ov2/api/captcha/app/verify", body)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("app verify status = %d, want 400 (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "CAPTCHA_REQUIRED") {
		t.Fatalf("app verify body = %s, want CAPTCHA_REQUIRED", w.Body.String())
	}
}

func TestCaptchaVerifyRejectsBadPayload(t *testing.T) {
	r := newCaptchaTestRouter(altcha.New(nil, altcha.Config{Enabled: true, HMACKey: "test-key", Cost: 10}))

	w := doCaptchaJSON(r, http.MethodPost, "/ov2/api/captcha/verify", `{"altcha":"not-base64!"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("verify status = %d, want 400", w.Code)
	}
	if !strings.Contains(w.Body.String(), "CAPTCHA_REQUIRED") {
		t.Fatalf("verify body = %s, want CAPTCHA_REQUIRED", w.Body.String())
	}
}

func TestVerifyRequestBehavior(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)

	// 未注入 / 未启用：跳过。
	if !VerifyRequest(c, nil, "", "") {
		t.Fatal("nil service must skip ALTCHA")
	}
	if !VerifyRequest(c, altcha.New(nil, altcha.Config{Enabled: false}), "", "") {
		t.Fatal("disabled service must skip ALTCHA")
	}

	// 启用但无 proof：fail-closed。
	svc := altcha.New(nil, altcha.Config{Enabled: true, HMACKey: "test-key"})
	if VerifyRequest(c, svc, "", "") {
		t.Fatal("missing proof must be rejected")
	}

	// 有效 grant 通过，篡改后拒绝。
	grant, err := svc.Grant(c.ClientIP())
	if err != nil {
		t.Fatalf("Grant() error = %v", err)
	}
	if !VerifyRequest(c, svc, "", grant) {
		t.Fatal("valid grant must pass")
	}
	if VerifyRequest(c, svc, "", grant+"x") {
		t.Fatal("tampered grant must be rejected")
	}
}

// TestCaptchaAppEndToEnd 走一遍 APP 零 PoW 协议的 HTTP 契约：挑战 → 一次 HMAC 证明 → 响应码。
// 本用例的 service 未挂数据库（无 nonce 消费存储），成功路径（200 + grant）见
// altcha/service_test.go 的 TestAppProofToGrantEndToEnd。
func TestCaptchaAppEndToEnd(t *testing.T) {
	r := newCaptchaTestRouter(altcha.New(nil, altcha.Config{Enabled: true, HMACKey: "test-key", AppSecret: appTestSecret}))
	// 本用例单独一个 IP 分桶：app verify 限流 12 次/分钟，不能与其它用例共用。
	ip := nextTestIP()

	// 1) 挑战：32 位 hex nonce + 服务端 Unix 秒（客户端零 PoW），且不可缓存。
	w := doCaptchaJSONFrom(r, http.MethodGet, "/ov2/api/captcha/app/challenge", "", ip)
	if w.Code != http.StatusOK {
		t.Fatalf("app challenge status = %d, want 200 (%s)", w.Code, w.Body.String())
	}
	var chal struct {
		Success   bool   `json:"success"`
		Challenge string `json:"challenge"`
		Timestamp int64  `json:"timestamp"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &chal); err != nil {
		t.Fatalf("decode app challenge: %v", err)
	}
	if !chal.Success || len(chal.Challenge) != 32 {
		t.Fatalf("challenge must be 32 hex chars: %+v", chal)
	}
	if _, err := hex.DecodeString(chal.Challenge); err != nil {
		t.Fatalf("challenge is not hex: %v", err)
	}
	if drift := time.Since(time.Unix(chal.Timestamp, 0)); drift > time.Minute || drift < -time.Minute {
		t.Fatalf("timestamp drift = %v, want within 1m", drift)
	}
	if chal.ExpiresIn != int(altcha.AppChallengeTTL.Seconds()) {
		t.Fatalf("expires_in = %d, want %d", chal.ExpiresIn, int(altcha.AppChallengeTTL.Seconds()))
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("app challenge Cache-Control = %q, want no-store", got)
	}

	// 2) config 两个开关都要正确。
	cfgBody := doCaptchaJSONFrom(r, http.MethodGet, "/ov2/api/captcha/config", "", ip)
	var cfg struct {
		Enabled    bool `json:"enabled"`
		AppEnabled bool `json:"app_enabled"`
	}
	if err := json.Unmarshal(cfgBody.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if !cfg.Enabled || !cfg.AppEnabled {
		t.Fatalf("config = %+v, want enabled/app_enabled both true", cfg)
	}

	// 3) 错误签名 / 其它密钥 / 时间戳超窗 / 缺字段：一律 400 CAPTCHA_REQUIRED。
	reqBody := func(challenge string, timestamp int64, signature string) string {
		return fmt.Sprintf(`{"challenge":%q,"timestamp":%d,"signature":%q}`, challenge, timestamp, signature)
	}
	now := time.Now().Unix()
	badCases := []struct {
		name string
		body string
	}{
		{"bad-signature", reqBody(chal.Challenge, chal.Timestamp, "deadbeef")},
		{"other-secret", reqBody(chal.Challenge, chal.Timestamp, testAppSignature("another-secret", chal.Challenge, chal.Timestamp))},
		{"stale-timestamp", reqBody(chal.Challenge, now-10*60, testAppSignature(appTestSecret, chal.Challenge, now-10*60))},
		{"missing-signature", fmt.Sprintf(`{"challenge":%q,"timestamp":%d}`, chal.Challenge, chal.Timestamp)},
	}
	for _, tc := range badCases {
		t.Run(tc.name, func(t *testing.T) {
			w := doCaptchaJSONFrom(r, http.MethodPost, "/ov2/api/captcha/app/verify", tc.body, ip)
			if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "CAPTCHA_REQUIRED") {
				t.Fatalf("app verify = %d %s, want 400 CAPTCHA_REQUIRED", w.Code, w.Body.String())
			}
		})
	}

	// 4) 签名正确时 handler 交给 service 校验 nonce 一次性；本用例 service 无存储 → fail-closed，
	//    重复提交（重放）同样 400，绝不会因为签名对而放行。
	valid := reqBody(chal.Challenge, chal.Timestamp, testAppSignature(appTestSecret, chal.Challenge, chal.Timestamp))
	for attempt := 1; attempt <= 2; attempt++ {
		w := doCaptchaJSONFrom(r, http.MethodPost, "/ov2/api/captcha/app/verify", valid, ip)
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "CAPTCHA_REQUIRED") {
			t.Fatalf("attempt %d = %d %s, want 400 CAPTCHA_REQUIRED (fail-closed without store)", attempt, w.Code, w.Body.String())
		}
	}
}

// TestVerifyRequestAcceptsAppGrant：APP 通道拿到的 grant（同一 HMAC key 签发）可直接用于业务端点。
func TestVerifyRequestAcceptsAppGrant(t *testing.T) {
	svc := altcha.New(nil, altcha.Config{Enabled: true, HMACKey: "test-key", AppSecret: appTestSecret})

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	c.Request.RemoteAddr = "203.0.113.7:4321"

	grant, err := svc.Grant(c.ClientIP())
	if err != nil {
		t.Fatalf("Grant() error = %v", err)
	}
	if !VerifyRequest(c, svc, "", grant) {
		t.Fatal("grant issued by the app channel must pass VerifyRequest")
	}
	if VerifyRequest(c, svc, "", grant+"x") {
		t.Fatal("tampered grant must be rejected")
	}

	// grant 绑定签发 IP：换一个客户端不得复用。
	other, _ := gin.CreateTestContext(httptest.NewRecorder())
	other.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	other.Request.RemoteAddr = "198.51.100.9:4321"
	if VerifyRequest(other, svc, "", grant) {
		t.Fatal("grant must be bound to the issuing IP")
	}
}

// TestCaptchaStandardRoutesRateLimited：标准 PoW 通道限流（challenge 60/分、verify 20/分）。
// 每个用例用独立 IP，避免与其它用例共享分桶。
func TestCaptchaStandardRoutesRateLimited(t *testing.T) {
	r := newCaptchaTestRouter(altcha.New(nil, altcha.Config{Enabled: true, HMACKey: "test-key", Cost: 10, Expires: time.Minute}))

	// 每次运行用不同的 IP 分桶（198.18/198.19 为基准测试保留段），
	// 避免 -count=N 重复执行时命中上一轮的计数。
	challengeIP := nextTestIP()
	verifyIP := nextTestIP()

	for i := 1; i <= 60; i++ {
		if w := doCaptchaJSONFrom(r, http.MethodGet, "/ov2/api/captcha/challenge", "", challengeIP); w.Code != http.StatusOK {
			t.Fatalf("challenge #%d status = %d, want 200 (%s)", i, w.Code, w.Body.String())
		}
	}
	if w := doCaptchaJSONFrom(r, http.MethodGet, "/ov2/api/captcha/challenge", "", challengeIP); w.Code != http.StatusTooManyRequests {
		t.Fatalf("challenge #61 status = %d, want 429", w.Code)
	}

	const verifyLimit = 20
	for i := 1; i <= verifyLimit; i++ {
		// 荷载非法但在限流之后才解析，因此这 20 次都应是 400。
		if w := doCaptchaJSONFrom(r, http.MethodPost, "/ov2/api/captcha/verify", `{"altcha":"not-base64!"}`, verifyIP); w.Code != http.StatusBadRequest {
			t.Fatalf("verify #%d status = %d, want 400 (%s)", i, w.Code, w.Body.String())
		}
	}
	if w := doCaptchaJSONFrom(r, http.MethodPost, "/ov2/api/captcha/verify", `{"altcha":"not-base64!"}`, verifyIP); w.Code != http.StatusTooManyRequests {
		t.Fatalf("verify #21 status = %d, want 429", w.Code)
	}
}
