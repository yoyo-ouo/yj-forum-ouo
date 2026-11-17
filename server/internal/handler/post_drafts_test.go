package handler

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizePostTitle(t *testing.T) {
	if got, msg := normalizePostTitle("  hello  "); got != "hello" || msg != "" {
		t.Fatalf("normal title = %q, msg=%q", got, msg)
	}
	if _, msg := normalizePostTitle("   "); msg == "" {
		t.Fatal("empty title should fail")
	}
	if _, msg := normalizePostTitle(strings.Repeat("字", 101)); msg == "" {
		t.Fatal("101-rune title should fail")
	}
	if _, msg := normalizePostTitle(strings.Repeat("字", 100)); msg != "" {
		t.Fatal("100-rune title should pass")
	}
}

func TestNormalizeDraftTitle(t *testing.T) {
	if got, msg := normalizeDraftTitle("  "); got != "" || msg != "" {
		t.Fatalf("empty draft title should pass, got %q msg=%q", got, msg)
	}
	if _, msg := normalizeDraftTitle(strings.Repeat("字", 101)); msg == "" {
		t.Fatal("overlong draft title should fail")
	}
}

func TestCleanPostContentStrict(t *testing.T) {
	if got, msg := cleanPostContent("<p></p>", false); got != "<p></p>" || msg != "" {
		t.Fatalf("draft empty content should pass, got %q msg=%q", got, msg)
	}
	if _, msg := cleanPostContent("<p></p>", true); msg != "正文不能为空" {
		t.Fatalf("publish empty content msg = %q", msg)
	}
	if _, msg := cleanPostContent(`<p><img src="/ov2/api/media/MD1"></p>`, true); msg != "" {
		t.Fatalf("image-only post should pass, got %q", msg)
	}
	var b strings.Builder
	b.WriteString("<p>x</p>")
	for i := 0; i < 61; i++ {
		b.WriteString(`<img src="/ov2/api/media/MD1">`)
	}
	if _, msg := cleanPostContent(b.String(), true); msg != "图片/引用数量过多" {
		t.Fatalf("too many images msg = %q", msg)
	}
	if _, msg := cleanPostContent(b.String(), false); msg != "" {
		t.Fatal("draft should allow too many images (publish validates later)")
	}
	if _, msg := cleanPostContent(strings.Repeat("x", maxPostContentBytes+1), false); msg != "正文过长" {
		t.Fatalf("oversize msg = %q", msg)
	}
}

func TestParsePostSchedule(t *testing.T) {
	if got, msg := parsePostSchedule("", true); got != nil || msg != "" {
		t.Fatalf("empty schedule = %v msg=%q", got, msg)
	}
	if _, msg := parsePostSchedule("not-a-date", false); msg == "" {
		t.Fatal("invalid draft schedule should fail format check")
	}
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	if got, msg := parsePostSchedule(past, false); got == nil || msg != "" {
		t.Fatalf("past draft schedule should be stored, got %v msg=%q", got, msg)
	}
	if _, msg := parsePostSchedule(past, true); msg == "" {
		t.Fatal("past publish schedule should fail")
	}
	future := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	if got, msg := parsePostSchedule(future, true); got == nil || msg != "" {
		t.Fatalf("future publish schedule = %v msg=%q", got, msg)
	}
	tooFar := time.Now().Add(400 * 24 * time.Hour).UTC().Format(time.RFC3339)
	if _, msg := parsePostSchedule(tooFar, true); msg == "" {
		t.Fatal(">365d publish schedule should fail")
	}
}

func TestNormalizePublishToken(t *testing.T) {
	if token, msg := normalizePublishToken("  "); token != "" || msg != "" {
		t.Fatalf("empty token should pass, got %q msg=%q", token, msg)
	}
	if token, msg := normalizePublishToken(" 550e8400-e29b-41d4-a716-446655440000 "); token != "550e8400-e29b-41d4-a716-446655440000" || msg != "" {
		t.Fatalf("uuid token = %q msg=%q", token, msg)
	}
	if _, msg := normalizePublishToken(strings.Repeat("a", 65)); msg == "" {
		t.Fatal("overlong token should fail")
	}
	if _, msg := normalizePublishToken("bad token"); msg == "" {
		t.Fatal("token with space should fail")
	}
	if _, msg := normalizePublishToken("bad.token"); msg == "" {
		t.Fatal("token with dot should fail")
	}
	if _, msg := normalizePublishToken("ok_token-123"); msg != "" {
		t.Fatalf("valid token charset should pass, msg=%q", msg)
	}
}
