package handler

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateReportPayload(t *testing.T) {
	validReasons := []string{"spam", "abuse", "porn", "illegal", "infringement", "other"}
	for _, reason := range validReasons {
		gotReason, gotDetail, err := validateReportPayload(reason, " 详情 ")
		if err != nil {
			t.Fatalf("reason %q 应合法：%v", reason, err)
		}
		if gotReason != reason || gotDetail != "详情" {
			t.Fatalf("reason %q 归一化 = %q/%q", reason, gotReason, gotDetail)
		}
	}

	// 白名单外（含大小写变体、空串、绕过尝试）一律拒绝。
	for _, reason := range []string{"", "   ", "SPAM", "Spam", "harassment", "spam,abuse", "spam;drop table"} {
		if _, _, err := validateReportPayload(reason, ""); !errors.Is(err, errReportReasonInvalid) {
			t.Fatalf("reason %q err = %v, want errReportReasonInvalid", reason, err)
		}
	}

	// 原因首尾空白会被裁掉后命中白名单。
	if reason, _, err := validateReportPayload("  spam\n", ""); err != nil || reason != "spam" {
		t.Fatalf("去空白 reason = %q err = %v", reason, err)
	}

	// 详情：去首尾空白后 ≤500 字，超过则拒绝。
	detail500 := strings.Repeat("详", maxReportDetailRunes)
	if _, got, err := validateReportPayload("other", "  "+detail500+"  "); err != nil || got != detail500 {
		t.Fatalf("500 字详情应合法：err=%v len=%d", err, len([]rune(got)))
	}
	detail501 := strings.Repeat("详", maxReportDetailRunes+1)
	if _, _, err := validateReportPayload("other", detail501); !errors.Is(err, errReportDetailTooLong) {
		t.Fatalf("501 字详情 err = %v, want errReportDetailTooLong", err)
	}
	// 空白不计入长度：500 字 + 首尾空白仍应通过。
	if _, _, err := validateReportPayload("spam", "\t"+detail500+"\n"); err != nil {
		t.Fatalf("首尾空白不应计入长度：%v", err)
	}
}

func TestIsSelfReport(t *testing.T) {
	cases := []struct {
		name     string
		author   string
		reporter string
		want     bool
	}{
		{"作者自己举报", "U1", "U1", true},
		{"他人举报", "U1", "U2", false},
		{"空作者", "", "", false},
		{"作者为空但举报人不为空", "", "U1", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isSelfReport(tc.author, tc.reporter); got != tc.want {
				t.Fatalf("isSelfReport(%q,%q) = %v, want %v", tc.author, tc.reporter, got, tc.want)
			}
		})
	}
}
