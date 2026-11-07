"use client";

// ===== 引用节点（embed）数据层 =====
// 存储契约（三端一致）：<div data-embed="user|post|article|character" data-id="..."
//   [data-variant="card|compact"] [data-size="sm|md|lg"] [data-fields="..."] [data-align="left|center"]></div>
// 缺省属性不输出：variant 缺省 = card，size 缺省 = md，align 缺省 = left；
// data-fields 缺省 = 全字段显示，空串 = 全不显示。

import { useEffect, useState } from "react";
import {
  embedApi,
  EmbedArticleItem,
  EmbedCharacterItem,
  EmbedKind,
  EmbedPostItem,
  EmbedResolved,
  EmbedUserItem,
} from "./api";

/** 引用节点解析后的属性（已归一化） */
export interface EmbedSpec {
  type: EmbedKind;
  id: string;
  variant: "card" | "compact";
  size: "sm" | "md" | "lg";
  /** null = data-fields 缺省（全显示）；字符串（可为空串）= 显式子集 */
  fields: string | null;
  align: "left" | "center";
}

/** 引用数据（查不到/请求失败时为 null） */
export type EmbedResolvedItem =
  | { type: "user"; user: EmbedUserItem }
  | { type: "post"; post: EmbedPostItem }
  | { type: "article"; article: EmbedArticleItem }
  | { type: "character"; character: EmbedCharacterItem };

/** 原始属性（DOM 属性或 TipTap 节点属性）：fields 为 undefined 表示属性缺省 */
export interface RawEmbedAttrs {
  type?: string | null;
  id?: string | null;
  variant?: string | null;
  size?: string | null;
  fields?: string | null;
  align?: string | null;
}

/** 归一化引用属性；类型/ id 非法时返回 null */
export function normalizeEmbed(raw: RawEmbedAttrs): EmbedSpec | null {
  const type = (raw.type || "").trim();
  if (type !== "user" && type !== "post" && type !== "article" && type !== "character") return null;
  const id = (raw.id || "").trim();
  if (!id) return null;
  return {
    type,
    id,
    variant: raw.variant === "compact" ? "compact" : "card",
    size: raw.size === "sm" || raw.size === "lg" ? raw.size : "md",
    fields: typeof raw.fields === "string" ? raw.fields : null,
    align: raw.align === "center" ? "center" : "left",
  };
}

/** 从 DOM 节点（[data-embed]）解析引用属性 */
export function parseEmbedElement(el: Element): EmbedSpec | null {
  return normalizeEmbed({
    type: el.getAttribute("data-embed"),
    id: el.getAttribute("data-id"),
    variant: el.getAttribute("data-variant"),
    size: el.getAttribute("data-size"),
    // 属性缺省（hasAttribute=false）→ undefined（全显示）；空串保留为空串（全不显示）
    fields: el.hasAttribute("data-fields") ? el.getAttribute("data-fields") || "" : undefined,
    align: el.getAttribute("data-align"),
  });
}

/** 序列化为存储态 HTML 属性（缺省属性不输出，空 data-fields 保留） */
export function embedAttrs(spec: EmbedSpec): Record<string, string> {
  const attrs: Record<string, string> = { "data-embed": spec.type, "data-id": spec.id };
  if (spec.variant !== "card") attrs["data-variant"] = spec.variant;
  if (spec.size !== "md") attrs["data-size"] = spec.size;
  if (spec.fields !== null) attrs["data-fields"] = spec.fields;
  if (spec.align !== "left") attrs["data-align"] = spec.align;
  return attrs;
}

/** data-fields 语义：null（缺省）= 全显示；否则按子集包含判断 */
export function hasEmbedField(fields: string | null, name: string): boolean {
  if (fields === null) return true;
  return fields
    .split(",")
    .map((s) => s.trim())
    .includes(name);
}

/** 用户字段开关（契约子集） */
export const USER_EMBED_FIELDS = [
  { key: "intro", label: "简介" },
  { key: "guild", label: "会馆" },
] as const;

export function embedKey(type: EmbedKind, id: string): string {
  return `${type}:${id}`;
}

// ===== 模块级缓存 + 进行中去重 =====

/** 缓存 TTL：5 分钟（与后端缓存粒度无关，纯前端降重） */
const CACHE_TTL = 5 * 60 * 1000;
/** 服务端每类 id 上限（超出分块请求，避免部分 id 被截断后误判为不存在） */
const MAX_IDS_PER_TYPE = 30;

type CacheEntry = { expires: number; value: EmbedResolvedItem | null };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<void>>();

/** 按类型取出响应里的条目（后端每类字段可选） */
function resolvedList(
  type: EmbedKind,
  resp: EmbedResolved
): (EmbedUserItem | EmbedPostItem | EmbedArticleItem | EmbedCharacterItem)[] {
  if (type === "user") return resp.users || [];
  if (type === "post") return resp.posts || [];
  if (type === "article") return resp.articles || [];
  return resp.characters || [];
}

/** 把接口条目包成带类型的缓存值 */
function resolvedValue(
  type: EmbedKind,
  item: EmbedUserItem | EmbedPostItem | EmbedArticleItem | EmbedCharacterItem
): EmbedResolvedItem {
  if (type === "user") return { type: "user", user: item as EmbedUserItem };
  if (type === "post") return { type: "post", post: item as EmbedPostItem };
  if (type === "article") return { type: "article", article: item as EmbedArticleItem };
  return { type: "character", character: item as EmbedCharacterItem };
}

/** 单块请求：一次可携带多种类型（后端 /embeds 同时支持），命中写缓存，失败不写（下次重试） */
async function fetchChunk(idsByType: Partial<Record<EmbedKind, string[]>>): Promise<void> {
  let resp: EmbedResolved;
  try {
    resp = await embedApi.resolve({
      users: idsByType.user,
      posts: idsByType.post,
      articles: idsByType.article,
      characters: idsByType.character,
    });
  } catch {
    return;
  }
  const now = Date.now();
  for (const type of Object.keys(idsByType) as EmbedKind[]) {
    const ids = idsByType[type] ?? [];
    if (ids.length === 0) continue;
    const found = new Set<string>();
    for (const item of resolvedList(type, resp)) {
      if (!ids.includes(item.id)) continue;
      const key = embedKey(type, item.id);
      cache.set(key, { expires: now + CACHE_TTL, value: resolvedValue(type, item) });
      found.add(key);
    }
    // 请求成功但未返回的 id：内容已删除或不可用（负缓存）
    for (const id of ids) {
      const key = embedKey(type, id);
      if (!found.has(key)) cache.set(key, { expires: now + CACHE_TTL, value: null });
    }
  }
}

/** 发起一批请求（同 key 的并发调用复用同一 Promise） */
function startBatch(specs: EmbedSpec[]): Promise<void> {
  const byType: Record<EmbedKind, string[]> = { user: [], post: [], article: [], character: [] };
  for (const spec of specs) {
    const list = byType[spec.type];
    if (!list.includes(spec.id)) list.push(spec.id);
  }
  // 每类上限 30 个 id：把「第 k 批」跨类型合并进同一个请求，
  // 请求数 = max(ceil(n/30)) 而不是 sum —— 旧实现按类型各发一个，一个含
  // 用户+帖子+文章的引用页会白白多发 2 个请求。
  const longest = Math.max(0, ...(Object.keys(byType) as EmbedKind[]).map((t) => byType[t].length));
  const rounds = Math.ceil(longest / MAX_IDS_PER_TYPE);
  const chunks: Promise<void>[] = [];
  for (let i = 0; i < rounds; i++) {
    const slice: Partial<Record<EmbedKind, string[]>> = {};
    (Object.keys(byType) as EmbedKind[]).forEach((type) => {
      const part = byType[type].slice(i * MAX_IDS_PER_TYPE, (i + 1) * MAX_IDS_PER_TYPE);
      if (part.length > 0) slice[type] = part;
    });
    if (Object.keys(slice).length > 0) chunks.push(fetchChunk(slice));
  }
  const task = Promise.all(chunks).then(() => undefined);
  for (const spec of specs) inflight.set(embedKey(spec.type, spec.id), task);
  void task.then(() => {
    for (const spec of specs) {
      const key = embedKey(spec.type, spec.id);
      if (inflight.get(key) === task) inflight.delete(key);
    }
  });
  return task;
}

/**
 * 批量解析引用节点数据：
 * - 模块缓存（TTL 5min）命中直接返回；
 * - 未命中合并为一次 embedApi.resolve（每类 ≤30，超出分块）；
 * - 进行中去重：并发调用同一 id 只发一次请求；
 * - 返回 Map<`type:id`, 数据|null>（null = 已删除/不可用/请求失败，由调用方回退占位）。
 */
export async function loadEmbeds(specs: EmbedSpec[]): Promise<Map<string, EmbedResolvedItem | null>> {
  const out = new Map<string, EmbedResolvedItem | null>();
  const missing: EmbedSpec[] = [];
  const seen = new Set<string>();
  const waits: Promise<void>[] = [];
  for (const spec of specs) {
    const key = embedKey(spec.type, spec.id);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      out.set(key, hit.value);
      continue;
    }
    const pending = inflight.get(key);
    if (pending) {
      waits.push(pending);
      continue;
    }
    missing.push(spec);
  }
  if (missing.length > 0) waits.push(startBatch(missing));
  if (waits.length > 0) await Promise.all(waits);
  for (const key of seen) {
    if (!out.has(key)) out.set(key, cache.get(key)?.value ?? null);
  }
  return out;
}

/** 单个引用节点的加载态（编辑器 NodeView 预览用） */
export function useEmbed(type: string | null | undefined, id: string | null | undefined): {
  loading: boolean;
  data: EmbedResolvedItem | null;
} {
  const spec = normalizeEmbed({ type, id });
  const key = spec ? embedKey(spec.type, spec.id) : "";
  // 仅记录「已解析完成的 key + 数据」；未完成（含 key 变化）由派生值表达加载态，
  // 避免在 effect 内同步 setState 造成级联渲染
  const [state, setState] = useState<{ key: string; data: EmbedResolvedItem | null }>({ key: "", data: null });

  useEffect(() => {
    if (!spec || !key) return;
    let alive = true;
    void loadEmbeds([spec]).then((map) => {
      if (alive) setState({ key, data: map.get(key) ?? null });
    });
    return () => {
      alive = false;
    };
    // spec 对象每次渲染都会重建，依赖收敛到 type:id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, type, id]);

  if (!spec || !key) return { loading: false, data: null };
  if (state.key !== key) return { loading: true, data: null };
  return { loading: false, data: state.data };
}
