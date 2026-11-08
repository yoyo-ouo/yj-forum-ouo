/**
 * 无限历 ⇄ 公元历换算（纯前端，无接口依赖）。
 *
 * 口径（与 Web 端 lib/year-conversion.ts 一致）：
 * - 无限元年 = 公元 1604 年，无限 N 年 = 公元 (1604 + N - 1) 年；
 * - 公元 1604 年之前记为「无限前 N 年」（无限前 1 年 = 公元 1603 年 = 公元前 1 年）；
 * - 两套纪年都从 1 起算，没有 0 年；
 * - 输入用「带符号年份」表示：-1 = 公元前 1 年（天文纪年 0），0 非法。
 */

export const INFINITE_EPOCH = 1604;

export type InfiniteEra = "after" | "before";
export type GregorianEra = "ce" | "bce";

export interface InfiniteYear {
  year: number;
  before: boolean;
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
export function formatInfiniteYear(year: number, before: boolean): string {
  if (before) return `无限前 ${year} 年`;
  return year === 1 ? "无限元年" : `无限 ${year} 年`;
}

/** 天文纪年展示：公元 N 年 / 公元前 N 年 */
export function formatGregorianYear(astronomicalYear: number): string {
  return astronomicalYear >= 1 ? `公元 ${astronomicalYear} 年` : `公元前 ${1 - astronomicalYear} 年`;
}
