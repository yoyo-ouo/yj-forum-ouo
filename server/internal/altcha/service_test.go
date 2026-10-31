package altcha

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	altchalib "github.com/altcha-org/altcha-lib-go/v2"
)

type memStore struct {
	mu   sync.Mutex
	used map[string]time.Time
}

func newMemStore() *memStore {
	return &memStore{used: make(map[string]time.Time)}
}

func (m *memStore) Consume(_ context.Context, challengeID string, expiresAt time.Time) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.used[challengeID]; ok {
		return false, nil
	}
	m.used[challengeID] = expiresAt
	return true, nil
}

func newTestService() *Service {
	svc := New(nil, Config{
		Enabled:   true,
		HMACKey:   "test-hmac-key",
		Algorithm: DefaultAlgorithm,
		Cost:      10,
		Expires:   time.Minute,
	})
	svc.store = newMemStore()
	svc.randInt = func(int) int { return 0 }
	return svc
}

func solvePayload(t *testing.T, svc *Service) (altchalib.Payload, string) {
	t.Helper()
	challenge, err := svc.Challenge(context.Background())
	if err != nil {
		t.Fatalf("Challenge() error = %v", err)
	}
	solution, err := altchalib.SolveChallenge(altchalib.SolveChallengeOptions{
		Challenge:   challenge,
		DeriveKey:   altchalib.DeriveKeyPBKDF2(),
		CounterStep: 1,
	})
	if err != nil || solution == nil {
		t.Fatalf("SolveChallenge() = %v, %v", solution, err)
	}
	payload := altchalib.Payload{Challenge: challenge, Solution: *solution}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return payload, base64.StdEncoding.EncodeToString(raw)
}

func TestChallengeVerifyAndReplay(t *testing.T) {
	svc := newTestService()
	_, encoded := solvePayload(t, svc)

	ok, err := svc.Verify(context.Background(), encoded)
	if err != nil || !ok {
		t.Fatalf("first Verify() = %v, %v; want true, nil", ok, err)
	}
	ok, err = svc.Verify(context.Background(), encoded)
	if err != nil {
		t.Fatalf("replay Verify() error = %v", err)
	}
	if ok {
		t.Fatal("replayed payload must not verify")
	}
}

func TestChallengeTampered(t *testing.T) {
	svc := newTestService()
	payload, encoded := solvePayload(t, svc)
	_ = encoded

	// 篡改挑战参数（cost）后签名不匹配。
	payload.Challenge.Parameters.Cost++
	raw, _ := json.Marshal(payload)
	ok, err := svc.Verify(context.Background(), base64.StdEncoding.EncodeToString(raw))
	if err != nil {
		t.Fatalf("tampered challenge Verify() error = %v", err)
	}
	if ok {
		t.Fatal("tampered challenge must not verify")
	}

	// 篡改 solution 的 derivedKey。
	payload, encoded = solvePayload(t, svc)
	_ = encoded
	if payload.Solution.DerivedKey == "" {
		t.Fatal("derivedKey is empty")
	}
	flipped := []byte(payload.Solution.DerivedKey)
	if flipped[0] == '0' {
		flipped[0] = '1'
	} else {
		flipped[0] = '0'
	}
	payload.Solution.DerivedKey = string(flipped)
	raw, _ = json.Marshal(payload)
	ok, err = svc.Verify(context.Background(), base64.StdEncoding.EncodeToString(raw))
	if err != nil {
		t.Fatalf("tampered solution Verify() error = %v", err)
	}
	if ok {
		t.Fatal("tampered solution must not verify")
	}
}

func TestChallengeExpired(t *testing.T) {
	svc := newTestService()
	svc.expires = -time.Minute
	_, encoded := solvePayload(t, svc)

	ok, err := svc.Verify(context.Background(), encoded)
	if err != nil {
		t.Fatalf("expired Verify() error = %v", err)
	}
	if ok {
		t.Fatal("expired challenge must not verify")
	}
}

func TestGrantLifecycle(t *testing.T) {
	svc := New(nil, Config{Enabled: true, HMACKey: "grant-secret"})
	now := time.Unix(1_700_000_000, 0)
	svc.now = func() time.Time { return now }

	token, err := svc.Grant()
	if err != nil {
		t.Fatalf("Grant() error = %v", err)
	}
	if !svc.VerifyGrant(token) {
		t.Fatal("fresh grant must verify")
	}

	// 未到期仍有效。
	now = now.Add(GrantTTL - time.Second)
	if !svc.VerifyGrant(token) {
		t.Fatal("grant must be valid before expiry")
	}

	// 过期失效。
	now = now.Add(2 * time.Second)
	if svc.VerifyGrant(token) {
		t.Fatal("expired grant must not verify")
	}
}

func TestGrantTampered(t *testing.T) {
	svc := New(nil, Config{Enabled: true, HMACKey: "grant-secret"})
	token, err := svc.Grant()
	if err != nil {
		t.Fatalf("Grant() error = %v", err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		t.Fatalf("unexpected grant format: %q", token)
	}

	cases := []string{
		"",
		"garbage",
		parts[0] + "." + strings.Repeat("A", len(parts[1])),
		parts[0] + "x." + parts[1],
	}
	for _, bad := range cases {
		if svc.VerifyGrant(bad) {
			t.Errorf("VerifyGrant(%q) = true, want false", bad)
		}
	}

	// 不同 key 签发的 token 不能通过。
	other := New(nil, Config{Enabled: true, HMACKey: "other-secret"})
	otherToken, _ := other.Grant()
	if svc.VerifyGrant(otherToken) {
		t.Fatal("grant signed with another key must not verify")
	}
}

func TestFailClosed(t *testing.T) {
	ctx := context.Background()

	// 未启用：跳过校验。
	disabled := New(nil, Config{Enabled: false})
	if disabled.Enabled() {
		t.Fatal("disabled service must report Enabled()=false")
	}
	if _, err := disabled.Challenge(ctx); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled Challenge() error = %v", err)
	}
	if _, err := disabled.Verify(ctx, "x"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled Verify() error = %v", err)
	}
	if _, err := disabled.Grant(); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled Grant() error = %v", err)
	}
	if disabled.VerifyGrant("x") {
		t.Fatal("disabled VerifyGrant() must be false")
	}

	// 启用但缺 HMAC key：仍然 Enabled（调用方必须继续要求校验），操作全部失败。
	misconfigured := New(nil, Config{Enabled: true, HMACKey: ""})
	if !misconfigured.Enabled() {
		t.Fatal("enabled service must report Enabled()=true even without key")
	}
	if _, err := misconfigured.Challenge(ctx); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("misconfigured Challenge() error = %v", err)
	}
	if _, err := misconfigured.Verify(ctx, "x"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("misconfigured Verify() error = %v", err)
	}
	if _, err := misconfigured.Grant(); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("misconfigured Grant() error = %v", err)
	}
	if misconfigured.VerifyGrant("x") {
		t.Fatal("misconfigured VerifyGrant() must be false")
	}

	// 启用且签名有效，但没有消费存储：verify 必须失败（不能放行）。
	svc := New(nil, Config{Enabled: true, HMACKey: "key", Cost: 10, Expires: time.Minute})
	svc.randInt = func(int) int { return 0 }
	payload, encoded := solvePayload(t, svc)
	_ = payload
	if _, err := svc.Verify(ctx, encoded); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("Verify() without store error = %v, want ErrNotConfigured", err)
	}
}

func TestNilService(t *testing.T) {
	var svc *Service
	if svc.Enabled() {
		t.Fatal("nil service Enabled() must be false")
	}
	if svc.Algorithm() != DefaultAlgorithm || svc.Cost() != DefaultCost {
		t.Fatal("nil service getters must return defaults")
	}
	if _, err := svc.Challenge(context.Background()); !errors.Is(err, ErrDisabled) {
		t.Fatalf("nil Challenge() error = %v", err)
	}
	if _, err := svc.Verify(context.Background(), "x"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("nil Verify() error = %v", err)
	}
	if _, err := svc.Grant(); !errors.Is(err, ErrDisabled) {
		t.Fatalf("nil Grant() error = %v", err)
	}
	if svc.VerifyGrant("x") {
		t.Fatal("nil VerifyGrant() must be false")
	}
}

func TestVerifyRejectsMalformedPayload(t *testing.T) {
	svc := newTestService()
	for _, bad := range []string{"", "!!!", base64.StdEncoding.EncodeToString([]byte("not json"))} {
		ok, err := svc.Verify(context.Background(), bad)
		if ok {
			t.Errorf("Verify(%q) = true, want false", bad)
		}
		if err == nil {
			t.Errorf("Verify(%q) error = nil, want error", bad)
		}
	}
}

// ---- APP 专用零 PoW 通道 ----

func newAppTestService(secret string) *Service {
	svc := New(nil, Config{
		Enabled:   true,
		HMACKey:   "test-hmac-key",
		Algorithm: DefaultAlgorithm,
		Cost:      10,
		Expires:   time.Minute,
		AppSecret: secret,
	})
	svc.store = newMemStore()
	svc.now = func() time.Time { return time.Unix(1_700_000_000, 0) }
	return svc
}

func TestAppChannelDisabledWithoutSecret(t *testing.T) {
	svc := newAppTestService("")
	if svc.AppEnabled() {
		t.Fatal("AppEnabled() must be false without app secret")
	}
	if _, _, err := svc.AppChallenge(); !errors.Is(err, ErrDisabled) {
		t.Fatalf("AppChallenge() error = %v, want ErrDisabled", err)
	}
	ok, err := svc.VerifyAppProof(context.Background(), strings.Repeat("a", 32), svc.now().Unix(), "x")
	if ok || !errors.Is(err, ErrDisabled) {
		t.Fatalf("VerifyAppProof() = %v, %v, want false/ErrDisabled", ok, err)
	}
}

func TestAppProofSignatureVector(t *testing.T) {
	// 向量与 Android `AltchaTest.appProof_matchesServerVector` 完全一致，保证两端字节一致。
	if got := appProofSignature("test-app-secret", "0123456789abcdef0123456789abcdef", 1_700_000_000); got != "360663eaffba0e3d783d0c63473a9d682ac959605c4d8ea64955870aff9b21eb" {
		t.Fatalf("appProofSignature() = %s", got)
	}
	if got := appProofSignature("another-secret", "ffffffffffffffffffffffffffffffff", 1_700_000_123); got != "06fea3e8189db2186318e1b390029a0eebd7d3ee8fac7c7509a36a726903b539" {
		t.Fatalf("appProofSignature() = %s", got)
	}
}

func TestAppChallengeShape(t *testing.T) {
	svc := newAppTestService("app-secret")
	if !svc.AppEnabled() {
		t.Fatal("AppEnabled() must be true with app secret")
	}
	challenge, timestamp, err := svc.AppChallenge()
	if err != nil {
		t.Fatalf("AppChallenge() error = %v", err)
	}
	if len(challenge) != 32 {
		t.Fatalf("challenge length = %d, want 32 hex chars (%q)", len(challenge), challenge)
	}
	if _, err := hex.DecodeString(challenge); err != nil {
		t.Fatalf("challenge is not hex: %v", err)
	}
	if timestamp != svc.now().Unix() {
		t.Fatalf("timestamp = %d, want %d", timestamp, svc.now().Unix())
	}
	other, _, err := svc.AppChallenge()
	if err != nil || other == challenge {
		t.Fatalf("challenge must be random: %q vs %q (err=%v)", challenge, other, err)
	}
}

func TestAppVerifyThenReplay(t *testing.T) {
	svc := newAppTestService("app-secret")
	challenge, timestamp, err := svc.AppChallenge()
	if err != nil {
		t.Fatalf("AppChallenge() error = %v", err)
	}
	sig := appProofSignature("app-secret", challenge, timestamp)

	// 签名大小写不敏感。
	ok, err := svc.VerifyAppProof(context.Background(), challenge, timestamp, strings.ToUpper(sig))
	if err != nil || !ok {
		t.Fatalf("VerifyAppProof() = %v, %v, want true/nil", ok, err)
	}
	// 同一 nonce 重放必须失败。
	ok, err = svc.VerifyAppProof(context.Background(), challenge, timestamp, sig)
	if err != nil || ok {
		t.Fatalf("replay VerifyAppProof() = %v, %v, want false/nil", ok, err)
	}
}

func TestAppVerifyRejectsBadInput(t *testing.T) {
	svc := newAppTestService("app-secret")
	challenge, timestamp, err := svc.AppChallenge()
	if err != nil {
		t.Fatalf("AppChallenge() error = %v", err)
	}
	skew := int64((appChallengeSkew + time.Minute).Seconds())

	cases := []struct {
		name      string
		challenge string
		timestamp int64
		signature string
	}{
		{"bad-signature", challenge, timestamp, strings.Repeat("0", 64)},
		{"empty-signature", challenge, timestamp, ""},
		{"short-challenge", "abcd", timestamp, appProofSignature("app-secret", "abcd", timestamp)},
		{"non-hex-challenge", strings.Repeat("z", 32), timestamp, appProofSignature("app-secret", strings.Repeat("z", 32), timestamp)},
		{"stale-timestamp", challenge, timestamp - skew, appProofSignature("app-secret", challenge, timestamp-skew)},
		{"future-timestamp", challenge, timestamp + skew, appProofSignature("app-secret", challenge, timestamp+skew)},
		{"zero-timestamp", challenge, 0, appProofSignature("app-secret", challenge, 0)},
		{"other-secret", challenge, timestamp, appProofSignature("other-secret", challenge, timestamp)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ok, err := svc.VerifyAppProof(context.Background(), tc.challenge, tc.timestamp, tc.signature)
			if ok || err != nil {
				t.Fatalf("VerifyAppProof() = %v, %v, want false/nil", ok, err)
			}
		})
	}
}

func TestAppVerifyWithoutStoreFailsClosed(t *testing.T) {
	svc := newAppTestService("app-secret")
	svc.store = nil
	challenge, timestamp, err := svc.AppChallenge()
	if err != nil {
		t.Fatalf("AppChallenge() error = %v", err)
	}
	sig := appProofSignature("app-secret", challenge, timestamp)
	ok, err := svc.VerifyAppProof(context.Background(), challenge, timestamp, sig)
	if ok || !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("VerifyAppProof() = %v, %v, want false/ErrNotConfigured", ok, err)
	}
}

func TestNilServiceAppChannel(t *testing.T) {
	var svc *Service
	if svc.AppEnabled() {
		t.Fatal("nil service AppEnabled() must be false")
	}
	if _, _, err := svc.AppChallenge(); !errors.Is(err, ErrDisabled) {
		t.Fatalf("nil AppChallenge() error = %v, want ErrDisabled", err)
	}
	if ok, err := svc.VerifyAppProof(context.Background(), strings.Repeat("a", 32), time.Now().Unix(), "x"); ok || !errors.Is(err, ErrDisabled) {
		t.Fatalf("nil VerifyAppProof() = %v, %v, want false/ErrDisabled", ok, err)
	}
}
