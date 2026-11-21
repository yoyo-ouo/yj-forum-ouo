"use client";

// ===== 设定记录（角色设定卡）API =====
// - 一人多角色；编辑写草稿（JSONB），「完成并公开 / 发布新版本」才对外可见
// - 草稿只对本人与管理员可见；已公开内容对所有人（含游客）可见

import { request, ApiException } from "@/lib/api";

/** 六大能力系（与后端白名单一致） */
export type CharacterCategory =
  | "御灵系"
  | "生灵系"
  | "锁御系"
  | "造物系"
  | "心灵系"
  | "空间系";

export interface CharacterAbility {
  category: CharacterCategory | string;
  detail: string;
}

export interface CharacterQuote {
  id: number;
  content: string;
  is_active: boolean;
}

export interface CharacterQuoteInput {
  content: string;
}

export interface CharacterGuildRef {
  mode: "none" | "existing" | "custom";
  guild_id: number;
  custom_name: string;
}

/** 编辑期内容（草稿 JSONB 与发布请求共用） */
export interface CharacterPayload {
  name: string;
  alias: string;
  title: string;
  gender: number;
  age: string;
  build: string;
  species: string;
  identity: string;
  description_html: string;
  avatar_media_id: string;
  image_media_ids: string[];
  guild: CharacterGuildRef;
  abilities: CharacterAbility[];
  quotes: CharacterQuoteInput[];
  quotes_visible: boolean;
}

/** 设定详情（status: 0 草稿 / 1 已公开 / 2 管理员下架） */
export interface CharacterSheet {
  id: string;
  user_id: string;
  status: number;
  version: number;
  name: string;
  alias: string;
  title: string;
  gender: number;
  age: string;
  build: string;
  species: string;
  identity: string;
  description_html: string;
  avatar_media_id: string;
  avatar: string;
  guild_id: number | null;
  guild_uuid: string;
  guild_name: string;
  guild_theme_color: string;
  guild_custom_name: string;
  quotes_visible: boolean;
  like_count: number;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  abilities: CharacterAbility[];
  images: string[];
  quotes: CharacterQuote[];
  owner_name: string;
  owner_avatar: string;
  owner_prefix: string;
  liked: boolean;
  mine: boolean;
  has_draft: boolean;
  draft_updated_at: string | null;
  draft?: CharacterPayload | null;
}

/** 空设定（新建角色时的初始表单） */
export function emptyCharacterPayload(): CharacterPayload {
  return {
    name: "",
    alias: "",
    title: "",
    gender: 0,
    age: "",
    build: "",
    species: "",
    identity: "",
    description_html: "",
    avatar_media_id: "",
    image_media_ids: [],
    guild: { mode: "none", guild_id: 0, custom_name: "" },
    abilities: [],
    quotes: [],
    quotes_visible: false,
  };
}

/** 从已公开内容或草稿构建编辑表单值 */
export function payloadFromSheet(sheet: CharacterSheet): CharacterPayload {
  if (sheet.draft) return { ...emptyCharacterPayload(), ...sheet.draft };
  return {
    name: sheet.name,
    alias: sheet.alias,
    title: sheet.title,
    gender: sheet.gender,
    age: sheet.age,
    build: sheet.build,
    species: sheet.species,
    identity: sheet.identity,
    description_html: sheet.description_html,
    avatar_media_id: sheet.avatar_media_id,
    image_media_ids: [...(sheet.images || [])],
    guild: sheet.guild_id
      ? { mode: "existing", guild_id: sheet.guild_id, custom_name: "" }
      : sheet.guild_custom_name
        ? { mode: "custom", guild_id: 0, custom_name: sheet.guild_custom_name }
        : { mode: "none", guild_id: 0, custom_name: "" },
    abilities: (sheet.abilities || []).map((a) => ({ category: a.category, detail: a.detail })),
    quotes: (sheet.quotes || []).map((q) => ({ content: q.content })),
    quotes_visible: sheet.quotes_visible,
  };
}

/** 展示用视图：从未发布过的角色（status=0）优先展示草稿内容。
 *  批量创建会把解析结果写进草稿 JSONB，而 character_sheets 的展示列仍为空；
 *  不合并的话，刚创建的角色会在列表/角色页显示成空的「未命名角色」。
 *  已发布角色的草稿仍只在编辑器里显示（保持原有「发布后才更新主页」的行为）。 */
export function characterSheetForDisplay(sheet: CharacterSheet): CharacterSheet {
  const d = sheet.draft;
  if (!d || sheet.status !== 0) return sheet;
  return {
    ...sheet,
    name: d.name || sheet.name,
    alias: d.alias,
    title: d.title,
    gender: d.gender,
    age: d.age,
    build: d.build,
    species: d.species,
    identity: d.identity,
    description_html: d.description_html,
    avatar_media_id: d.avatar_media_id,
    avatar: characterMediaUrl(d.avatar_media_id),
    quotes_visible: d.quotes_visible,
    abilities: d.abilities || [],
    images: d.image_media_ids || [],
    quotes: (d.quotes || []).map((q, i) => ({ id: -(i + 1), content: q.content, is_active: true })),
  };
}

/** 媒体 ID → 访问 URL */
export function characterMediaUrl(id: string): string {
  return id ? `/ov2/api/media/${id}` : "";
}

// ===== 批量添加（服务端解析；Web 不做第二套解析器）=====

/** 用户角色配额（全部状态均计入，与单创建入口同口径） */
export interface CharacterQuota {
  used: number;
  max: number;
  remaining: number;
}

/** 批量解析错误（line=0 表示批次级错误；field 为空表示行级错误） */
export interface CharacterBatchError {
  line?: number;
  identifier?: string;
  field?: string;
  code: string;
  message: string;
}

/** 一条解析成功的角色 */
export interface CharacterBatchItem {
  identifier: string;
  line: number;
  payload: CharacterPayload;
}

/** 预览响应；配额不足时不发放 token */
export interface CharacterBatchPreview {
  items: CharacterBatchItem[];
  count: number;
  quota: CharacterQuota;
  within_quota: boolean;
  token: string;
  expires_at: string | null;
  not_before: string | null;
}

/** 批量创建成功的角色 */
export interface CharacterBatchCreatedItem {
  id: string;
  name: string;
  identifier: string;
}

export interface CharacterBatchCreateResult {
  items: CharacterBatchCreatedItem[];
  count: number;
  quota: CharacterQuota;
  /** 同一预览凭证重复提交：回放首次结果，未新增数据 */
  replayed: boolean;
}

/** 从 ApiException 的响应体提取结构化解析错误 */
export function batchErrorsFrom(e: unknown): CharacterBatchError[] {
  if (!(e instanceof ApiException)) return [];
  const errs = (e.payload as { errors?: CharacterBatchError[] } | undefined)?.errors;
  return Array.isArray(errs) ? errs : [];
}

export const characterApi = {
  /** 我的全部设定（含草稿与草稿内容） */
  mine: () => request<{ items: CharacterSheet[] }>("/character-sheets/mine"),
  /** 某用户的设定（公开；本人额外拿到草稿与引导状态） */
  byUser: (userId: string) =>
    request<{ items: CharacterSheet[]; prompt_seen?: boolean }>(
      `/character-sheets/user/${encodeURIComponent(userId)}`
    ),
  detail: (id: string) => request<{ item: CharacterSheet }>(`/character-sheets/${encodeURIComponent(id)}`),
  create: () => request<{ item: CharacterSheet }>("/character-sheets", { method: "POST" }),
  saveDraft: (id: string, payload: CharacterPayload) =>
    request<{ saved_at: string }>(`/character-sheets/${encodeURIComponent(id)}/draft`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  publish: (id: string, payload: CharacterPayload) =>
    request<{ item: CharacterSheet }>(`/character-sheets/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  discardDraft: (id: string) =>
    request<{ success: boolean }>(`/character-sheets/${encodeURIComponent(id)}/draft`, { method: "DELETE" }),
  remove: (id: string) =>
    request<{ success: boolean }>(`/character-sheets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  like: (id: string) =>
    request<{ liked: boolean; likes: number }>(`/character-sheets/${encodeURIComponent(id)}/like`, {
      method: "POST",
    }),
  /** 引用选择器：空关键词返回最新公开设定 */
  search: (k = "", page = 1, pageSize = 10) =>
    request<{ items: CharacterSheet[]; has_more: boolean; page: number }>(
      `/character-sheets/search?k=${encodeURIComponent(k)}&page=${page}&page_size=${pageSize}`
    ),
  /** 标记注册引导已展示（只弹一次） */
  promptSeen: () => request<{ success: boolean }>("/character-sheets/prompt-seen", { method: "POST" }),
  /** 当前用户角色配额 */
  quota: () => request<{ quota: CharacterQuota }>("/character-sheets/quota"),
  /** 批量解析预览（不创建任何角色） */
  batchPreview: (content: string) =>
    request<CharacterBatchPreview>("/character-sheets/batch/preview", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  /** 正式批量创建（全部草稿；需携带预览凭证） */
  batchCreate: (content: string, token: string) =>
    request<CharacterBatchCreateResult>("/character-sheets/batch", {
      method: "POST",
      body: JSON.stringify({ content, token }),
    }),
};
