"use client";

// ===== 设定记录常量 =====
// 六系颜色通过 CSS 类名（.cs-ab-1 ~ .cs-ab-6）下发，日/夜两套在 character-sheet.css 中定义。

export const CHARACTER_CATEGORIES = ["御灵系", "生灵系", "锁御系", "造物系", "心灵系", "空间系"] as const;

export type CharacterCategoryName = (typeof CHARACTER_CATEGORIES)[number];

/** 能力系 → 1..6（未知回退 0） */
export function categoryIndex(name: string): number {
  const i = CHARACTER_CATEGORIES.indexOf(name as CharacterCategoryName);
  return i >= 0 ? i + 1 : 0;
}

/** 体态常用标签（快速填入） */
export const CHARACTER_BUILD_PRESETS = [
  "幼小",
  "纤细",
  "修长",
  "匀称",
  "健硕",
  "高挑",
  "魁梧",
  "轻盈",
] as const;

/** 性别：0 无 / 1 男 / 2 女（与后端一致） */
export const CHARACTER_GENDERS = [
  { value: 1, label: "男" },
  { value: 2, label: "女" },
  { value: 0, label: "无" },
] as const;

export function genderLabel(value: number): string {
  if (value === 1) return "男";
  if (value === 2) return "女";
  return "无";
}

/** 编辑器限制（与后端校验保持一致） */
export const CHARACTER_LIMITS = {
  name: 24,
  short: 32,
  guild: 64,
  abilities: 10,
  abilityDetail: 60,
  images: 3,
  quotes: 20,
  quote: 120,
} as const;
