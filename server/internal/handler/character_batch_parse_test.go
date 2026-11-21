package handler

import (
	"fmt"
	"strings"
	"testing"
)

func hasBatchError(errs []CharacterBatchError, code string, line int, field string) bool {
	for _, e := range errs {
		if e.Code == code && e.Line == line && e.Field == field {
			return true
		}
	}
	return false
}

func TestParseCharacterBatchValid(t *testing.T) {
	content := "A：name-白夜|alias-夜|title-守灯人|gender-1|age-20|build-修长|species-人类|identity-旅人\n" +
		"\n" +
		"B:name-黑夜|age-21|description-灯下的影子|ability-御灵系:灯影|ability-空间系：空间折叠|quote-灯不必亮，路自会让人看见。|quote-我一直在这里。|quotes_visible-true\n"

	items, errs := parseCharacterBatch(content)
	if len(errs) > 0 {
		t.Fatalf("unexpected errors: %+v", errs)
	}
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d", len(items))
	}
	a := items[0]
	if a.Identifier != "A" || a.Line != 1 {
		t.Fatalf("item A meta = %s/%d", a.Identifier, a.Line)
	}
	if a.Payload.Name != "白夜" || a.Payload.Alias != "夜" || a.Payload.Title != "守灯人" {
		t.Fatalf("item A payload = %+v", a.Payload)
	}
	if a.Payload.Gender != 1 || a.Payload.Age != "20" || a.Payload.Build != "修长" || a.Payload.Species != "人类" || a.Payload.Identity != "旅人" {
		t.Fatalf("item A fields = %+v", a.Payload)
	}
	if a.Payload.Guild.Mode != "none" {
		t.Fatalf("guild mode = %q", a.Payload.Guild.Mode)
	}
	if a.Payload.Abilities == nil || a.Payload.Quotes == nil || a.Payload.ImageMediaIDs == nil {
		t.Fatal("slices must be non-nil for JSON/frontend stability")
	}

	b := items[1]
	if b.Payload.DescriptionHTML != "<p>灯下的影子</p>" {
		t.Fatalf("description = %q", b.Payload.DescriptionHTML)
	}
	if len(b.Payload.Abilities) != 2 || b.Payload.Abilities[1].Category != "空间系" || b.Payload.Abilities[1].Detail != "空间折叠" {
		t.Fatalf("abilities = %+v", b.Payload.Abilities)
	}
	if len(b.Payload.Quotes) != 2 || !b.Payload.QuotesVisible {
		t.Fatalf("quotes = %+v visible=%v", b.Payload.Quotes, b.Payload.QuotesVisible)
	}
}

func TestParseCharacterBatchEscapesAndHyphen(t *testing.T) {
	// 反斜杠转义：\| → |，\\ → \\；属性值里其余 '-' 原样保留
	content := `A:name-White-Night|title-A\|B|alias-a\\b`
	items, errs := parseCharacterBatch(content)
	if len(errs) > 0 {
		t.Fatalf("unexpected errors: %+v", errs)
	}
	if items[0].Payload.Name != "White-Night" {
		t.Fatalf("name = %q", items[0].Payload.Name)
	}
	if items[0].Payload.Title != "A|B" {
		t.Fatalf("title = %q", items[0].Payload.Title)
	}
	if items[0].Payload.Alias != `a\b` {
		t.Fatalf("alias = %q", items[0].Payload.Alias)
	}
}

func TestParseCharacterBatchDescriptionEscaped(t *testing.T) {
	items, errs := parseCharacterBatch(`A:name-白夜|description-<script>alert(1)</script>`)
	if len(errs) > 0 {
		t.Fatalf("unexpected errors: %+v", errs)
	}
	got := items[0].Payload.DescriptionHTML
	if strings.Contains(got, "<script>") {
		t.Fatalf("script tag must be escaped: %q", got)
	}
	if !strings.Contains(got, "&lt;script&gt;") {
		t.Fatalf("escaped content missing: %q", got)
	}
}

func TestParseCharacterBatchErrors(t *testing.T) {
	cases := []struct {
		name    string
		content string
		code    string
		line    int
		field   string
		idInMsg string
	}{
		{"missing identifier", "name-白夜", "INVALID_LINE", 1, "", ""},
		{"invalid identifier", "AB:name-白夜", "INVALID_IDENTIFIER", 1, "", "AB"},
		{"duplicate identifier", "A:name-白夜\nA:name-黑夜", "DUPLICATE_IDENTIFIER", 2, "", "A"},
		{"missing name", "A:age-20", "MISSING_NAME", 1, "name", ""},
		{"empty name", "A:name-", "EMPTY_NAME", 1, "name", ""},
		{"unknown field", "A:name-白夜|foo-bar", "UNKNOWN_FIELD", 1, "foo", ""},
		{"guild not allowed", "A:name-白夜|guild-12", "UNKNOWN_FIELD", 1, "guild", ""},
		{"high not allowed", "A:name-白夜|high-x", "UNKNOWN_FIELD", 1, "high", ""},
		{"duplicate scalar", "A:name-白夜|age-20|age-21", "DUPLICATE_FIELD", 1, "age", ""},
		{"invalid gender", "A:name-白夜|gender-3", "INVALID_GENDER", 1, "gender", ""},
		{"gender words", "A:name-白夜|gender-男", "INVALID_GENDER", 1, "gender", ""},
		{"invalid ability", "A:name-白夜|ability-灯影", "INVALID_ABILITY", 1, "ability", ""},
		{"unknown category", "A:name-白夜|ability-水系:水", "UNKNOWN_ABILITY_CATEGORY", 1, "ability", ""},
		{"empty ability detail", "A:name-白夜|ability-御灵系:", "INVALID_ABILITY", 1, "ability", ""},
		{"invalid boolean", "A:name-白夜|quotes_visible-yes", "INVALID_BOOLEAN", 1, "quotes_visible", ""},
		{"invalid escape", `A:name-白夜|title-a\b`, "INVALID_ESCAPE", 1, "title", ""},
		{"trailing escape", `A:name-白夜|title-a\`, "INVALID_ESCAPE", 1, "title", ""},
		{"empty segment", "A:name-白夜||age-20", "EMPTY_ATTRIBUTE", 1, "", ""},
		{"long name", "A:name-" + strings.Repeat("名", characterMaxNameRunes+1), "FIELD_TOO_LONG", 1, "name", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, errs := parseCharacterBatch(tc.content)
			if len(errs) == 0 {
				t.Fatal("want errors, got none")
			}
			if !hasBatchError(errs, tc.code, tc.line, tc.field) {
				t.Fatalf("want %s on line %d field %q, got %+v", tc.code, tc.line, tc.field, errs)
			}
			if tc.idInMsg != "" && errs[0].Identifier != tc.idInMsg {
				t.Fatalf("identifier = %q, want %q", errs[0].Identifier, tc.idInMsg)
			}
		})
	}
}

func TestParseCharacterBatchCountLimits(t *testing.T) {
	// 能力超过 10 项
	abilities := make([]string, 0, characterMaxAbilities+1)
	for i := 0; i <= characterMaxAbilities; i++ {
		abilities = append(abilities, fmt.Sprintf("ability-御灵系:能力%d", i))
	}
	_, errs := parseCharacterBatch("A:name-白夜|" + strings.Join(abilities, "|"))
	if !hasBatchError(errs, "TOO_MANY_ABILITIES", 1, "ability") {
		t.Fatalf("want TOO_MANY_ABILITIES, got %+v", errs)
	}

	// 语录超过 20 条
	quotes := make([]string, 0, characterMaxQuotes+1)
	for i := 0; i <= characterMaxQuotes; i++ {
		quotes = append(quotes, fmt.Sprintf("quote-语录%d", i))
	}
	_, errs = parseCharacterBatch("A:name-白夜|" + strings.Join(quotes, "|"))
	if !hasBatchError(errs, "TOO_MANY_QUOTES", 1, "quote") {
		t.Fatalf("want TOO_MANY_QUOTES, got %+v", errs)
	}

	// 批次超过 20 个角色：21 个不同字母标识符
	lines := make([]string, 0, characterBatchMaxCharacters+1)
	for i := 0; i <= characterBatchMaxCharacters; i++ {
		id := string(rune('A' + i))
		lines = append(lines, fmt.Sprintf("%s:name-角色%d", id, i))
	}
	_, errs = parseCharacterBatch(strings.Join(lines, "\n"))
	if !hasBatchError(errs, "BATCH_TOO_LARGE", 21, "") {
		t.Fatalf("want BATCH_TOO_LARGE on line 21, got %+v", errs)
	}
}

func TestParseCharacterBatchEmptyAndTooLarge(t *testing.T) {
	_, errs := parseCharacterBatch("   \n\n")
	if !hasBatchError(errs, "EMPTY_CONTENT", 0, "") {
		t.Fatalf("want EMPTY_CONTENT, got %+v", errs)
	}
	_, errs = parseCharacterBatch(strings.Repeat("a", characterBatchMaxBytes+1))
	if !hasBatchError(errs, "BATCH_TOO_LARGE", 0, "") {
		t.Fatalf("want BATCH_TOO_LARGE, got %+v", errs)
	}
}

func TestParseCharacterBatchQuoteWithColon(t *testing.T) {
	items, errs := parseCharacterBatch(`A:name-白夜|quote-他说：灯会亮的。`)
	if len(errs) > 0 {
		t.Fatalf("unexpected errors: %+v", errs)
	}
	if items[0].Payload.Quotes[0].Content != "他说：灯会亮的。" {
		t.Fatalf("quote = %q", items[0].Payload.Quotes[0].Content)
	}
}
