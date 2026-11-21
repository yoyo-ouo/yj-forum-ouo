package handler

// 角色批量添加：文本解析器（服务端唯一解析实现，Web 端不重复解析）。
//
// 语法：每行一个角色
//
//	角色标识符：属性标识符-属性值|属性标识符-属性值
//
//   - 角色标识符为单个英文字母，仅用于定位与报错，不写入角色数据；
//   - 属性值支持转义：\| → |，\\ → \；其它反斜杠序列视为转义错误；
//   - 属性名与值按第一个未转义的 '-' 分割，值内其余 '-' 原样保留；
//   - ability 的值按第一个 ':' / '：' 分裂为「能力分类:能力内容」。
//
// 输出复用 models.CharacterSheetPayload，并用 normalizeCharacterPayload 做
// 与草稿/发布完全相同的一致性校验，避免批量入口绕过既有规则。

import (
	"fmt"
	"html"
	"strings"
	"unicode/utf8"

	"yj-forum/server/internal/models"
)

const (
	// characterBatchMaxCharacters 单次批量最多角色数（总配额 60，建议分批）。
	characterBatchMaxCharacters = 20
	// characterBatchMaxBytes 批量原文上限。
	characterBatchMaxBytes = 64 * 1024
	// characterBatchDescMaxRunes 批量文本中 description 单行上限（纯文本）。
	characterBatchDescMaxRunes = 2000
)

// CharacterBatchError 结构化解析/校验错误。
// Line 为 0 表示批次级错误（如空文本、批量过大）；Field 为空表示行级错误。
type CharacterBatchError struct {
	Line       int    `json:"line,omitempty"`
	Identifier string `json:"identifier,omitempty"`
	Field      string `json:"field,omitempty"`
	Code       string `json:"code"`
	Message    string `json:"message"`
}

// CharacterBatchItem 一条解析成功的角色（标识符 + 行号 + 标准负载）。
type CharacterBatchItem struct {
	Identifier string                       `json:"identifier"`
	Line       int                          `json:"line"`
	Payload    models.CharacterSheetPayload `json:"payload"`
}

func emptyCharacterBatchPayload() models.CharacterSheetPayload {
	return models.CharacterSheetPayload{
		Guild:         models.CharacterGuildRef{Mode: "none"},
		ImageMediaIDs: []string{},
		Abilities:     []models.CharacterAbility{},
		Quotes:        []models.CharacterQuoteInput{},
	}
}

// findUnescaped 返回第一个未转义分隔符的字节位置与匹配到的分隔符。
// seps 支持多字节（如全角冒号）；反斜杠后的字节整体跳过，转义合法性由 unescape 判定。
func findUnescaped(s string, seps ...string) (int, string) {
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' {
			i++
			continue
		}
		for _, sep := range seps {
			if strings.HasPrefix(s[i:], sep) {
				return i, sep
			}
		}
	}
	return -1, ""
}

// splitUnescaped 按未转义的 sep 分割；反斜杠后的字节整体跳过，
// 转义是否合法由 unescapeValue 在具体属性值上报告（便于定位到 field）。
func splitUnescaped(s string, sep byte) []string {
	parts := make([]string, 0, 4)
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' {
			i++
			continue
		}
		if s[i] == sep {
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	parts = append(parts, s[start:])
	return parts
}

// unescapeValue 还原 \| 与 \\；其它序列返回 false。
func unescapeValue(s string) (string, bool) {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' {
			b.WriteByte(s[i])
			continue
		}
		if i+1 >= len(s) || (s[i+1] != '\\' && s[i+1] != '|') {
			return "", false
		}
		b.WriteByte(s[i+1])
		i++
	}
	return b.String(), true
}

func isCharacterBatchIdentifier(s string) bool {
	if len(s) != 1 {
		return false
	}
	c := s[0]
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
}

// parseCharacterBatch 解析并校验批量文本。只要有任意错误就返回错误列表，
// 调用方必须拒绝整个批次（不允许部分成功）。
func parseCharacterBatch(content string) ([]CharacterBatchItem, []CharacterBatchError) {
	if strings.TrimSpace(content) == "" {
		return nil, []CharacterBatchError{{Code: "EMPTY_CONTENT", Message: "批量文本为空"}}
	}
	if len(content) > characterBatchMaxBytes {
		return nil, []CharacterBatchError{{
			Code:    "BATCH_TOO_LARGE",
			Message: fmt.Sprintf("批量文本不能超过 %d KB", characterBatchMaxBytes/1024),
		}}
	}

	items := make([]CharacterBatchItem, 0, 4)
	errs := make([]CharacterBatchError, 0, 4)
	seenIDs := make(map[string]bool, 4)
	itemCount := 0

	for idx, rawLine := range strings.Split(content, "\n") {
		lineNo := idx + 1
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}

		sepIdx, sep := findUnescaped(line, ":", "：")
		if sepIdx <= 0 {
			errs = append(errs, CharacterBatchError{
				Line: lineNo, Code: "INVALID_LINE",
				Message: "行格式应为「标识符：属性-值|属性-值」",
			})
			continue
		}
		identifier := strings.TrimSpace(line[:sepIdx])
		if !isCharacterBatchIdentifier(identifier) {
			errs = append(errs, CharacterBatchError{
				Line: lineNo, Identifier: identifier, Code: "INVALID_IDENTIFIER",
				Message: "角色标识符必须是单个英文字母",
			})
			continue
		}
		if seenIDs[identifier] {
			errs = append(errs, CharacterBatchError{
				Line: lineNo, Identifier: identifier, Code: "DUPLICATE_IDENTIFIER",
				Message: fmt.Sprintf("角色标识符「%s」在本批次内重复", identifier),
			})
			continue
		}
		seenIDs[identifier] = true
		itemCount++
		if itemCount > characterBatchMaxCharacters {
			errs = append(errs, CharacterBatchError{
				Line: lineNo, Identifier: identifier, Code: "BATCH_TOO_LARGE",
				Message: fmt.Sprintf("单次批量添加最多 %d 个角色", characterBatchMaxCharacters),
			})
			break
		}

		body := line[sepIdx+len(sep):]
		segments := splitUnescaped(body, '|')

		p := &characterBatchLineParser{
			line: lineNo, identifier: identifier,
			payload: emptyCharacterBatchPayload(), seen: map[string]bool{},
		}
		for _, segment := range segments {
			seg := strings.TrimSpace(segment)
			if seg == "" {
				p.add("", "EMPTY_ATTRIBUTE", "存在空的属性段（检查多余的 |）")
				continue
			}
			dashIdx, _ := findUnescaped(seg, "-")
			if dashIdx <= 0 {
				p.add("", "INVALID_ATTRIBUTE", "属性格式应为「属性标识符-属性值」")
				continue
			}
			key := strings.TrimSpace(seg[:dashIdx])
			value, ok := unescapeValue(seg[dashIdx+1:])
			if !ok {
				p.add(key, "INVALID_ESCAPE", "转义格式错误：反斜杠后只能跟 | 或 \\")
				continue
			}
			p.apply(key, strings.TrimSpace(value))
		}

		if !p.seen["name"] {
			p.add("name", "MISSING_NAME", "每个角色都必须填写 name 属性")
		}
		if len(p.errors) == 0 {
			// 与草稿/发布共用同一套归一化与清洗逻辑
			if msg := normalizeCharacterPayload(&p.payload, false); msg != "" {
				p.add("", "VALIDATION_FAILED", msg)
			}
		}

		if len(p.errors) > 0 {
			errs = append(errs, p.errors...)
			continue
		}
		items = append(items, CharacterBatchItem{Identifier: p.identifier, Line: p.line, Payload: p.payload})
	}

	if len(errs) > 0 {
		return nil, errs
	}
	return items, nil
}

// characterBatchLineParser 单行属性解析的临时状态。
type characterBatchLineParser struct {
	line       int
	identifier string
	payload    models.CharacterSheetPayload
	seen       map[string]bool
	errors     []CharacterBatchError
	abLimit    bool
	quoteLimit bool
}

func (p *characterBatchLineParser) add(field, code, message string) {
	p.errors = append(p.errors, CharacterBatchError{
		Line: p.line, Identifier: p.identifier, Field: field, Code: code, Message: message,
	})
}

func (p *characterBatchLineParser) duplicate(field, label string) bool {
	if p.seen[field] {
		p.add(field, "DUPLICATE_FIELD", fmt.Sprintf("%s 重复出现（该属性每行只能写一次）", label))
		return true
	}
	p.seen[field] = true
	return false
}

func (p *characterBatchLineParser) setScalar(field string, dst *string, maxRunes int, label, value string) {
	if p.seen[field] {
		p.add(field, "DUPLICATE_FIELD", fmt.Sprintf("%s 重复出现（该属性每行只能写一次）", label))
		return
	}
	p.seen[field] = true
	if value == "" {
		p.add(field, "EMPTY_VALUE", fmt.Sprintf("%s 不能为空", label))
		return
	}
	if utf8.RuneCountInString(value) > maxRunes {
		p.add(field, "FIELD_TOO_LONG", fmt.Sprintf("%s 不能超过 %d 个字符", label, maxRunes))
		return
	}
	*dst = value
}

// apply 处理单个属性。value 已去转义并 TrimSpace。
func (p *characterBatchLineParser) apply(key, value string) {
	switch key {
	case "name":
		if p.seen[key] {
			p.add(key, "DUPLICATE_FIELD", "name 重复出现（该属性每行只能写一次）")
			return
		}
		p.seen[key] = true
		if value == "" {
			p.add(key, "EMPTY_NAME", "name 不能为空")
			return
		}
		if utf8.RuneCountInString(value) > characterMaxNameRunes {
			p.add(key, "FIELD_TOO_LONG", fmt.Sprintf("name 不能超过 %d 个字符", characterMaxNameRunes))
			return
		}
		p.payload.Name = value
	case "alias":
		p.setScalar(key, &p.payload.Alias, characterMaxNameRunes, "alias", value)
	case "title":
		p.setScalar(key, &p.payload.Title, characterMaxNameRunes, "title", value)
	case "age":
		p.setScalar(key, &p.payload.Age, characterMaxShortRunes, "age", value)
	case "build":
		p.setScalar(key, &p.payload.Build, characterMaxShortRunes, "build", value)
	case "species":
		p.setScalar(key, &p.payload.Species, characterMaxShortRunes, "species", value)
	case "identity":
		p.setScalar(key, &p.payload.Identity, characterMaxShortRunes, "identity", value)
	case "gender":
		if p.duplicate(key, "gender") {
			return
		}
		switch value {
		case "0":
			p.payload.Gender = 0
		case "1":
			p.payload.Gender = 1
		case "2":
			p.payload.Gender = 2
		default:
			p.add(key, "INVALID_GENDER", "gender 只接受 0（无）/ 1（男）/ 2（女）")
		}
	case "description":
		if p.seen[key] {
			p.add(key, "DUPLICATE_FIELD", "description 重复出现（该属性每行只能写一次）")
			return
		}
		p.seen[key] = true
		if value == "" {
			p.add(key, "EMPTY_VALUE", "description 不能为空")
			return
		}
		if utf8.RuneCountInString(value) > characterBatchDescMaxRunes {
			p.add(key, "FIELD_TOO_LONG", fmt.Sprintf("description 不能超过 %d 个字符", characterBatchDescMaxRunes))
			return
		}
		// 批量文本只接收普通文本：先转义再包一层 <p>，不允许直接提交 HTML。
		p.payload.DescriptionHTML = "<p>" + html.EscapeString(value) + "</p>"
	case "ability":
		p.addAbility(value)
	case "quote":
		if value == "" {
			p.add(key, "EMPTY_VALUE", "quote 不能为空")
			return
		}
		if utf8.RuneCountInString(value) > characterQuoteMaxRunes {
			p.add(key, "FIELD_TOO_LONG", fmt.Sprintf("单条 quote 不能超过 %d 个字符", characterQuoteMaxRunes))
			return
		}
		if len(p.payload.Quotes) >= characterMaxQuotes {
			if !p.quoteLimit {
				p.quoteLimit = true
				p.add(key, "TOO_MANY_QUOTES", fmt.Sprintf("语录最多 %d 条", characterMaxQuotes))
			}
			return
		}
		p.payload.Quotes = append(p.payload.Quotes, models.CharacterQuoteInput{Content: value})
	case "quotes_visible":
		if p.seen[key] {
			p.add(key, "DUPLICATE_FIELD", "quotes_visible 重复出现（该属性每行只能写一次）")
			return
		}
		p.seen[key] = true
		switch value {
		case "true":
			p.payload.QuotesVisible = true
		case "false":
			p.payload.QuotesVisible = false
		default:
			p.add(key, "INVALID_BOOLEAN", "quotes_visible 只接受 true 或 false")
		}
	case "guild":
		p.add(key, "UNKNOWN_FIELD", "批量添加不支持会馆属性；请在角色创建后单独设置会馆")
	case "high":
		p.add(key, "UNKNOWN_FIELD", "不存在 high 属性")
	case "":
		p.add("", "INVALID_ATTRIBUTE", "属性标识符不能为空")
	default:
		p.add(key, "UNKNOWN_FIELD", fmt.Sprintf("未知属性标识符「%s」", key))
	}
}

func (p *characterBatchLineParser) addAbility(value string) {
	idx := strings.IndexAny(value, ":：")
	if idx < 0 {
		p.add("ability", "INVALID_ABILITY", "ability 格式应为「能力分类:能力内容」")
		return
	}
	sepLen := 1
	if value[idx] != ':' {
		sepLen = len("：")
	}
	category := strings.TrimSpace(value[:idx])
	detail := strings.TrimSpace(value[idx+sepLen:])
	if _, ok := characterCategories[category]; !ok {
		p.add("ability", "UNKNOWN_ABILITY_CATEGORY", fmt.Sprintf("能力分类「%s」不存在，只能是六大系之一", category))
		return
	}
	if detail == "" {
		p.add("ability", "INVALID_ABILITY", "能力内容不能为空")
		return
	}
	if utf8.RuneCountInString(detail) > characterAbilityMaxRunes {
		p.add("ability", "FIELD_TOO_LONG", fmt.Sprintf("单项能力描述不能超过 %d 个字符", characterAbilityMaxRunes))
		return
	}
	if len(p.payload.Abilities) >= characterMaxAbilities {
		if !p.abLimit {
			p.abLimit = true
			p.add("ability", "TOO_MANY_ABILITIES", fmt.Sprintf("能力最多 %d 项", characterMaxAbilities))
		}
		return
	}
	p.payload.Abilities = append(p.payload.Abilities, models.CharacterAbility{Category: category, Detail: detail})
}
