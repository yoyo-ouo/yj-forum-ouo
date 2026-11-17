package handler

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateProfileIntro(t *testing.T) {
	// 恰 200 字可接受，返回去首尾空白后的值。
	intro200 := strings.Repeat("字", profileIntroMaxRunes)
	got, err := validateProfileIntro("   " + intro200 + " \n")
	if err != nil || got != intro200 {
		t.Fatalf("200 字简介应合法：err=%v len=%d", err, len([]rune(got)))
	}

	// 201 字拒绝。
	intro201 := strings.Repeat("字", profileIntroMaxRunes+1)
	if _, err := validateProfileIntro(intro201); !errors.Is(err, errProfileIntroTooLong) {
		t.Fatalf("201 字简介 err = %v, want errProfileIntroTooLong", err)
	}

	// 空白不计入长度。
	if _, err := validateProfileIntro("\t" + intro200 + "  "); err != nil {
		t.Fatalf("首尾空白不应计入简介长度：%v", err)
	}

	// 空串合法且归一化为空。
	if got, err := validateProfileIntro("   "); err != nil || got != "" {
		t.Fatalf("空简介 = %q err = %v", got, err)
	}
}

func TestValidateProfileGender(t *testing.T) {
	for _, g := range []int{0, 1, 2} {
		if err := validateProfileGender(g); err != nil {
			t.Fatalf("gender %d 应合法：%v", g, err)
		}
	}
	for _, g := range []int{-1, 3, 9, 100} {
		if err := validateProfileGender(g); !errors.Is(err, errProfileGenderInvalid) {
			t.Fatalf("gender %d err = %v, want errProfileGenderInvalid", g, err)
		}
	}
}

func TestValidateProfileAge(t *testing.T) {
	// 32 字符（含中文）允许。
	age32 := strings.Repeat("岁", profileAgeMaxRunes)
	if got, err := validateProfileAge(age32); err != nil || got != age32 {
		t.Fatalf("32 字年龄 err = %v", err)
	}
	// 33 字符拒绝。
	if _, err := validateProfileAge(strings.Repeat("岁", profileAgeMaxRunes+1)); !errors.Is(err, errProfileAgeTooLong) {
		t.Fatalf("33 字年龄 err = %v, want errProfileAgeTooLong", err)
	}
	if _, err := validateProfileAge(""); err != nil {
		t.Fatalf("空年龄应合法：%v", err)
	}
}
