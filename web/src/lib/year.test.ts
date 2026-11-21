import { describe, expect, it } from "vitest";
import {
  astronomicalToInfinite,
  convertYear,
  formatGregorianYear,
  formatInfiniteYear,
  infiniteToAstronomical,
  parseSignedYear,
  parseYear,
  signedToAstronomical,
} from "./year";

describe("infinite year conversion", () => {
  it("anchors at 1604", () => {
    expect(infiniteToAstronomical(1, "after")).toBe(1604);
    expect(infiniteToAstronomical(423, "after")).toBe(2026);
    expect(infiniteToAstronomical(1, "before")).toBe(1603);
  });

  it("converts back", () => {
    expect(astronomicalToInfinite(2026)).toEqual({ year: 423, before: false });
    expect(astronomicalToInfinite(1603)).toEqual({ year: 1, before: true });
  });

  it("rejects year zero and parses signed input", () => {
    expect(parseSignedYear("423")).toBe(423);
    expect(parseSignedYear("元年")).toBe(1);
    expect(signedToAstronomical(-1)).toBe(0);
    expect(signedToAstronomical(0)).toBeNull();
  });

  it("formats labels", () => {
    expect(formatInfiniteYear(1, false)).toBe("无限元年");
    expect(formatInfiniteYear(12, true)).toBe("无限前 12 年");
    expect(formatGregorianYear(0)).toBe("公元前 1 年");
  });

  it("parses page input with full-width digits and 元年", () => {
    expect(parseYear("元年")).toBe(1);
    expect(parseYear("４２３")).toBe(423);
    expect(parseYear("-1")).toBeNull(); // 页面输入不接受负数
    expect(parseYear("1.5")).toBeNull();
  });

  it("formats 元年 only when enabled", () => {
    expect(formatGregorianYear(1, true)).toBe("公元元年");
    expect(formatGregorianYear(1, false)).toBe("公元 1 年");
    expect(formatInfiniteYear(1, false, false)).toBe("无限 1 年");
  });
});

describe("convertYear (页面唯一实现)", () => {
  const base = { era: "after", month: "1", day: "1" };

  it("无限 423 年 → 公元 2026 年", () => {
    const r = convertYear({ ...base, calendar: "infinite", year: "423" }, true);
    expect(r.type).toBe("success");
    expect(r.source).toMatchObject({ era: "无限", year: 423, month: 1, day: 1 });
    expect(r.target).toMatchObject({ era: "公元", year: 2026, month: 1, day: 1 });
  });

  it("无限前 1 年 → 公元 1603 年（天文年 1603，仍属公元）", () => {
    const r = convertYear({ ...base, calendar: "infinite", era: "before", year: "1" }, true);
    expect(r.type).toBe("success");
    // 无限前 1 年 = 天文年 1603：公元纪年里 1603 > 0，因此落在「公元」而非「公元前」。
    // 两者指的是同一年（公元 1603 年 == 公元前 1 年 = 天文年 0 的前一年），
    // 页面按公元纪年展示，不做跨越公元前 1 年的映射。
    expect(r.target).toMatchObject({ era: "公元", year: 1603 });
  });

  it("无限前 2 年 → 公元 1602 年", () => {
    const r = convertYear({ ...base, calendar: "infinite", era: "before", year: "2" }, true);
    expect(r.type).toBe("success");
    expect(r.target).toMatchObject({ era: "公元", year: 1602 });
  });

  it("公元纪年 → 无限前（1603 及更早）", () => {
    const r = convertYear({ ...base, calendar: "gregorian", era: "ce", year: "1602" }, true);
    expect(r.type).toBe("success");
    expect(r.target).toMatchObject({ era: "无限前", year: 2 });
  });

  it("公元 1604 年 → 无限元年", () => {
    const r = convertYear({ ...base, calendar: "gregorian", era: "ce", year: "1604" }, true);
    expect(r.type).toBe("success");
    expect(r.target).toMatchObject({ era: "无限", year: 1, yuanNian: true });
    expect(r.message).toContain("无限元年");
  });

  it("公元 1603 年 → 无限前 1 年", () => {
    const r = convertYear({ ...base, calendar: "gregorian", era: "ce", year: "1603" }, true);
    expect(r.type).toBe("success");
    expect(r.target).toMatchObject({ era: "无限前", year: 1 });
  });

  it("rejects year zero on both calendars", () => {
    const infinite = convertYear({ ...base, calendar: "infinite", year: "0" }, true);
    expect(infinite.type).toBe("error");
    expect(infinite.message).toContain("没有 0 年");
    const gregorian = convertYear({ ...base, calendar: "gregorian", era: "ce", year: "0" }, true);
    expect(gregorian.type).toBe("error");
    expect(gregorian.message).toContain("没有 0 年");
  });

  it("warns on non-leap 2/29 but accepts leap 2/29", () => {
    const bad = convertYear(
      { calendar: "gregorian", era: "ce", year: "1603", month: "2", day: "29" },
      true,
    );
    expect(bad.type).toBe("warning");
    expect(bad.message).toContain("不是闰年");

    const ok = convertYear(
      { calendar: "gregorian", era: "ce", year: "1604", month: "2", day: "29" },
      true,
    );
    expect(ok.type).toBe("success");
  });

  it("rejects out-of-range month and day", () => {
    expect(convertYear({ ...base, calendar: "gregorian", era: "ce", year: "2026", month: "13" }, true).type).toBe("error");
    expect(convertYear({ ...base, calendar: "gregorian", era: "ce", year: "2026", month: "4", day: "31" }, true).type).toBe("error");
  });

  it("keeps month/day unchanged in the message", () => {
    const r = convertYear(
      { calendar: "infinite", era: "after", year: "423", month: "7", day: "15" },
      true,
    );
    expect(r.message).toContain("7 月 15 日");
  });
});
