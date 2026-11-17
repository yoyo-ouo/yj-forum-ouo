/**
 * 无限历 ⇄ 公元历统一换算入口。
 *
 * 口径：无限元年 = 公元 1604 年；无限 N 年 = 公元 (1603 + N) 年；
 * 公元 1603 年及以前为「无限前 N 年」；两套纪年都不存在 0 年。
 * 公元纪年内部使用「天文年」计算：公元前 1 年 = 天文年 0。
 */

export const INFINITE_EPOCH = 1604;

export type Calendar = "infinite" | "gregorian";
export type InfiniteEra = "after" | "before";
export type GregorianEra = "ce" | "bce";
export type ResultType = "success" | "warning" | "error";

export interface SourceInput {
  calendar: Calendar;
  era: InfiniteEra | GregorianEra;
  year: string;
  month: string;
  day: string;
}

export interface ConversionResult {
  type: ResultType;
  message: string;
  /** 源纪年与目标纪年（成功时可用） */
  sourceLabel?: string;
  targetLabel?: string;
  astronomicalYear?: number;
  infiniteYear?: { year: number; before: boolean };
}

/** 公历闰年（天文纪年；天文年 0 = 公元前 1 年，按 400 年周期为闰年） */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** 指定公历年月天数 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/** 全角数字转半角（用户从中文输入法输入时可正常解析） */
function normalizeDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 解析非负整数年份：支持半角/全角数字与「元年」。
 * 空串、负数、小数、溢出返回 null。
 */
export function parseYear(raw: string): number | null {
  const s = normalizeDigits(raw).trim();
  if (s === "元年" || s === "元") return 1;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** 解析月份/日期（仅 ASCII/全角数字） */
export function parsePositiveInt(raw: string): number | null {
  const s = normalizeDigits(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** 公元年展示：year >= 1 为公元，<= 0 为公元前；1 年可显示为「元年」 */
export function formatGregorianYear(astronomicalYear: number, useYuanNian = true): string {
  if (astronomicalYear >= 1) {
    return astronomicalYear === 1 && useYuanNian ? "公元元年" : `公元 ${astronomicalYear} 年`;
  }
  return `公元前 ${1 - astronomicalYear} 年`;
}

/** 无限年展示：无限元年 / 无限 N 年 / 无限前 N 年 */
export function formatInfiniteYear(year: number, before: boolean, useYuanNian = true): string {
  if (before) return `无限前 ${year} 年`;
  return year === 1 && useYuanNian ? "无限元年" : `无限 ${year} 年`;
}

/** 天文公历年 → 无限历（无限元年 = 1604；1604 之前为无限前） */
export function toInfinite(astronomicalYear: number): { year: number; before: boolean } {
  return astronomicalYear >= INFINITE_EPOCH
    ? { year: astronomicalYear - INFINITE_EPOCH + 1, before: false }
    : { year: INFINITE_EPOCH - astronomicalYear, before: true };
}

/** 无限历 → 天文公历年（无限前 1 年 = 1603，即公元前 1 年 = 天文年 0） */
export function toAstronomicalFromInfinite(year: number, before: boolean): number {
  return before ? INFINITE_EPOCH - year : year + INFINITE_EPOCH - 1;
}

/** 公元纪年（公元前为正数）→ 天文公历年 */
export function toAstronomicalFromGregorian(year: number, era: GregorianEra): number {
  return era === "bce" ? 1 - year : year;
}

/** 校验月/日输入 */
function parseMonthDay(monthRaw: string, dayRaw: string): { month: number; day: number } | { error: string } {
  const month = parsePositiveInt(monthRaw);
  if (month === null || month < 1 || month > 12) return { error: "请输入 1-12 的月份" };
  const day = parsePositiveInt(dayRaw);
  if (day === null || day < 1 || day > 31) return { error: "请输入 1-31 的日期" };
  return { month, day };
}

/** 目标日期合法性：2 月 29 日落在非闰年时给出明确提示 */
function checkDate(astronomicalYear: number, month: number, day: number, useYuanNian: boolean) {
  const max = daysInMonth(astronomicalYear, month);
  if (day <= max) return {};
  const label = formatGregorianYear(astronomicalYear, useYuanNian);
  if (month === 2 && day === 29 && !isLeapYear(astronomicalYear)) {
    return { error: `目标${label}不是闰年，2 月 29 日不存在`, feb29: true };
  }
  return { error: `${label}的 ${month} 月只有 ${max} 天` };
}

/**
 * 统一换算入口：源纪年 → 目标纪年。
 * 年、月、日不改变月日，只换算年份；目标年日期非法时返回 warning/error。
 */
export function convertYear(
  input: SourceInput,
  target: Calendar,
  options: { useYuanNian?: boolean } = {}
): ConversionResult {
  const useYuanNian = options.useYuanNian !== false;
  const year = parseYear(input.year);
  if (year === null) {
    return { type: "error", message: input.calendar === "infinite" ? "请输入有效的无限年年份（可填「元年」）" : "请输入有效的公元年份（可填「元年」）" };
  }
  if (year === 0) {
    return {
      type: "error",
      message: input.calendar === "infinite" ? "无限历没有 0 年（元年即公元 1604 年）" : "公元纪年没有 0 年（公元前 1 年之后即公元 1 年）",
    };
  }
  const md = parseMonthDay(input.month, input.day);
  if ("error" in md) return { type: "error", message: md.error };

  const astronomical =
    input.calendar === "infinite"
      ? toAstronomicalFromInfinite(year, input.era === "before")
      : toAstronomicalFromGregorian(year, input.era as GregorianEra);
  const checked = checkDate(astronomical, md.month, md.day, useYuanNian);
  if (checked.error) {
    return { type: checked.feb29 ? "warning" : "error", message: checked.error };
  }

  const infinite = toInfinite(astronomical);
  const sourceLabel =
    input.calendar === "infinite"
      ? formatInfiniteYear(year, input.era === "before", useYuanNian)
      : formatGregorianYear(astronomical, useYuanNian);
  const targetLabel =
    target === "infinite"
      ? formatInfiniteYear(infinite.year, infinite.before, useYuanNian)
      : formatGregorianYear(astronomical, useYuanNian);

  return {
    type: "success",
    message: `${sourceLabel} ${md.month} 月 ${md.day} 日 = ${targetLabel} ${md.month} 月 ${md.day} 日`,
    sourceLabel,
    targetLabel,
    astronomicalYear: astronomical,
    infiniteYear: infinite,
  };
}

export interface Today {
  year: number;
  month: number;
  day: number;
}

/** 上海时区「今天」（与论坛签到 / 时间展示口径一致） */
export function shanghaiToday(): Today {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}
