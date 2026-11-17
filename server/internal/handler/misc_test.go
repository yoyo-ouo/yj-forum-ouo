package handler

import (
	"testing"
	"time"
)

func TestVerifyEmailResendAllowed(t *testing.T) {
	now := time.Date(2026, 11, 8, 16, 0, 0, 0, time.UTC)
	past := now.Add(-59 * time.Second)
	sixty := now.Add(-verifyEmailResendCooldown)
	older := now.Add(-10 * time.Minute)
	zero := time.Time{}

	cases := []struct {
		name string
		last *time.Time
		want bool
	}{
		{"从未发送", nil, true},
		{"零值时间视为从未发送", &zero, true},
		{"59 秒前发送过", &past, false},
		{"恰好 60 秒前发送过", &sixty, true},
		{"10 分钟前发送过", &older, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := verifyEmailResendAllowed(tc.last, now); got != tc.want {
				t.Fatalf("verifyEmailResendAllowed = %v, want %v", got, tc.want)
			}
		})
	}
}
