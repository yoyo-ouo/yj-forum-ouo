/**
 * 无限历 ⇄ 公元历换算（纯前端，无接口依赖）。
 *
 * 口径（与 Web 端 lib/year-conversion.ts 一致）：
 * - 无限元年 = 公元 1604 年，无限 N 年 = 公元 (1604 + N - 1) 年；
 * - 公元 1604 年之前记为「无限前 N 年」（无限前 1 年 = 公元 1603 年 = 公元前 1 年）；
 * - 两套纪年都从 1 起算，没有 0 年；
 * - 输入用「带符号年份」表示：-1 = 公元前 1 年（天文纪年 0），0 非法。
 *
 * 本文件是换算逻辑的唯一实现：页面（screens/misc.tsx）与测试都从这里导入，
 * 避免「页面跑一份、测试测另一份」的静默分叉。
 */

export const INFINITE_EPOCH = 1604;

export type Calendar = "infinite" | "gregorian";
export type InfiniteEra = "after" | "before";
export type GregorianEra = "ce" | "bce";
export type ResultType = "success" | "warning" | "error";

export interface InfiniteYear {
  year: number;
  before: boolean;
}

/** 换算结果的一侧（用于大数字对照卡片） */
export interface YearSide {
  era: string;
  year: number;
  month: number;
  day: number;
  /** 勾选「第 1 年显示为元年」且为本纪元第 1 年（不含无限前/公元前）时为 true */
  yuanNian?: boolean;
}

export interface YearConversionResult {
  type: ResultType;
  message: string;
  source?: YearSide;
  target?: YearSide;
}

export interface Today {
  year: number;
  month: number;
  day: number;
}

/** 全角数字转半角（中文输入法下也能正常解析） */
function normalizeDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 解析带符号年份：支持全角数字与「元年」。
 * 空串、小数、超出安全整数范围返回 null；0 由调用方按「不存在」拒绝。
 */
export function parseSignedYear(raw: string): number | null {
  const text = normalizeDigits(raw).trim();
  if (text === "元年" || text === "元") return 1;
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/** 解析非负整数年份（页面输入框用）：负数非法，其余同 parseSignedYear */
export function parseYear(raw: string): number | null {
  const text = normalizeDigits(raw).trim();
  if (text === "元年" || text === "元") return 1;
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/** 解析正整数（月 / 日输入用） */
export function parsePositiveInt(raw: string): number | null {
  const text = normalizeDigits(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/** 公历闰年（天文纪年；天文年 0 = 公元前 1 年，按 400 年周期为闰年） */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/** 无限历 → 天文纪年（公元前 1 年 = 天文纪年 0） */
export function infiniteToAstronomical(year: number, era: InfiniteEra): number {
  return era === "before" ? INFINITE_EPOCH - year : INFINITE_EPOCH + year - 1;
}

/** 天文纪年 → 无限历 */
export function astronomicalToInfinite(astronomicalYear: number): InfiniteYear {
  return astronomicalYear >= INFINITE_EPOCH
    ? { year: astronomicalYear - INFINITE_EPOCH + 1, before: false }
    : { year: INFINITE_EPOCH - astronomicalYear, before: true };
}

/** 带符号公元年 → 天文纪年；-1 = 公元前 1 年（天文纪年 0），0 不存在返回 null */
export function signedToAstronomical(signed: number): number | null {
  if (!Number.isSafeInteger(signed) || signed === 0) return null;
  return signed < 0 ? signed + 1 : signed;
}

/** 无限年展示：无限元年 / 无限 N 年 / 无限前 N 年 */
export function formatInfiniteYear(year: number, before: boolean, useYuanNian = true): string {
  if (before) return `无限前 ${year} 年`;
  return year === 1 && useYuanNian ? "无限元年" : `无限 ${year} 年`;
}

/** 天文纪年展示：公元元年 / 公元 N 年 / 公元前 N 年 */
export function formatGregorianYear(astronomicalYear: number, useYuanNian = true): string {
  if (astronomicalYear >= 1) {
    return astronomicalYear === 1 && useYuanNian ? "公元元年" : `公元 ${astronomicalYear} 年`;
  }
  return `公元前 ${1 - astronomicalYear} 年`;
}

/** 上海时区「今天」（与论坛签到 / 时间展示口径一致） */
export function shanghaiToday(): Today {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return { year: pick("year"), month: pick("month"), day: pick("day") };
  } catch {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }
}

/**
 * 统一换算入口（移植自 Web lib/year-conversion 的 convertYear）：
 * 不改月日，只换算年份；目标年日期非法时返回 warning / error。
 */
export function convertYear(
  input: { calendar: Calendar; era: string; year: string; month: string; day: string },
  useYuanNian: boolean,
): YearConversionResult {
  const year = parseYear(input.year);
  if (year === null) {
    return {
      type: "error",
      message: input.calendar === "infinite" ? "请输入有效的无限年年份（可填「元年」）" : "请输入有效的公元年份（可填「元年」）",
    };
  }
  if (year === 0) {
    return {
      type: "error",
      message:
        input.calendar === "infinite"
          ? "无限历没有 0 年（元年即公元 1604 年）"
          : "公元纪年没有 0 年（公元前 1 年之后即公元 1 年）",
    };
  }

  const month = parsePositiveInt(input.month);
  if (month === null || month < 1 || month > 12) return { type: "error", message: "请输入 1-12 的月份" };
  const day = parsePositiveInt(input.day);
  if (day === null || day < 1 || day > 31) return { type: "error", message: "请输入 1-31 的日期" };

  const astronomical =
    input.calendar === "infinite"
      ? infiniteToAstronomical(year, input.era as InfiniteEra)
      : input.era === "bce"
        ? 1 - year
        : year;

  const max = daysInMonth(astronomical, month);
  if (day > max) {
    const label = formatGregorianYear(astronomical, useYuanNian);
    if (month === 2 && day === 29 && !isLeapYear(astronomical)) {
      return { type: "warning", message: `目标${label}不是闰年，2 月 29 日不存在` };
    }
    return { type: "error", message: `${label}的 ${month} 月只有 ${max} 天` };
  }

  const infinite = astronomicalToInfinite(astronomical);
  const sourceLabel =
    input.calendar === "infinite"
      ? formatInfiniteYear(year, input.era === "before", useYuanNian)
      : formatGregorianYear(astronomical, useYuanNian);
  const targetLabel =
    input.calendar === "infinite"
      ? formatGregorianYear(astronomical, useYuanNian)
      : formatInfiniteYear(infinite.year, infinite.before, useYuanNian);

  const source: YearSide =
    input.calendar === "infinite"
      ? {
          era: input.era === "before" ? "无限前" : "无限",
          year,
          month,
          day,
          yuanNian: useYuanNian && year === 1 && input.era !== "before",
        }
      : {
          era: input.era === "bce" ? "公元前" : "公元",
          year,
          month,
          day,
          yuanNian: useYuanNian && year === 1 && input.era !== "bce",
        };
  const target: YearSide =
    input.calendar === "infinite"
      ? {
          era: astronomical >= 1 ? "公元" : "公元前",
          year: astronomical >= 1 ? astronomical : 1 - astronomical,
          month,
          day,
          yuanNian: useYuanNian && astronomical === 1,
        }
      : {
          era: infinite.before ? "无限前" : "无限",
          year: infinite.year,
          month,
          day,
          yuanNian: useYuanNian && !infinite.before && infinite.year === 1,
        };

  return {
    type: "success",
    message: `${sourceLabel} ${month} 月 ${day} 日 = ${targetLabel} ${month} 月 ${day} 日`,
    source,
    target,
  };
}
