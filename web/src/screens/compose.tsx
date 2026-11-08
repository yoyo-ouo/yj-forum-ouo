import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { registerBackHandler } from "../lib/back";
import { AppBar, Cell, Empty, IconButton, Screen, Segmented, Sheet } from "../components/mobile";
import { Icon } from "../components/icons";
import { CATEGORY_LABELS } from "../lib/format";
import type { PostDraft, PostDraftPayload } from "../lib/types";

/** TipTap/ProseMirror 体量大，只在进入发帖页时加载 */
const RichEditor = React.lazy(() =>
  import("../components/RichEditor").then((mod) => ({ default: mod.RichEditor })),
);

/* ======================= 常量（口径对齐 Web app/post/create 与 server） ======================= */

const COMPLIANCE = [
  "遵守中华人民共和国相关法律法规，不得发布违法违规内容",
  "禁止涉及政治敏感、涉黄涉暴、血腥恐怖、毒品赌博等内容",
  "禁止人身攻击、谩骂侮辱、恶意引战、网络暴力等行为",
  "禁止发布广告、刷量、引流等垃圾信息",
  "禁止泄露他人或自己的隐私信息（真实姓名、电话、地址等）",
  "禁止侵犯他人知识产权，转载请注明出处或获得授权",
  "内容应与论坛主题（罗小黑战记及二次元文化）相关，鼓励友善交流",
  "违反以上规定的帖子将被删除，情节严重者将封禁账号",
];

const PUBLIC_CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);
const TITLE_LIMIT = 100;

/** 与服务端一致的正文原始字节上限（256KB） */
const MAX_POST_CONTENT_BYTES = 256 * 1024;
/** 定时发布时间约束：最早当前时间 +5 分钟，最晚 +1 年 */
const SCHEDULE_MIN_AHEAD_MS = 5 * 60 * 1000;
const SCHEDULE_MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** 本地草稿（旧版只存在设备上）：首次打开发帖页时迁移到服务端草稿 */
const DRAFT_KEY = "yj.compose.draft.v1";
/** 迁移完成标记：避免每次打开发帖页重复迁移 */
const DRAFT_MIGRATED_KEY = "yj.compose.draft.migrated.v1";

/** 草稿自动保存状态（底部状态条） */
type DraftSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

type Target = "public" | "guild";

interface Draft {
  title: string;
  content: string;
  category: string;
  target: Target;
  scheduled: boolean;
  publishAt: string;
  updatedAt: number;
}

/** 富文本是否为空（无文本且无图片）：编辑器空文档序列化为 <p></p> */
function hasRichContent(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return !!text || /<img\b/i.test(html);
}

/** UTF-8 字节数（提交前提示，服务端仍会二次校验） */
function contentByteLength(html: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(html).length;
  return html.length * 3;
}

/** 本地时区 YYYY-MM-DDTHH:mm（datetime-local 的 min/max 口径） */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 向上取整到下一整分钟（分钟粒度下保证 min 提交时依旧有效） */
function ceilToMinute(time: number): Date {
  const date = new Date(time);
  if (date.getSeconds() > 0 || date.getMilliseconds() > 0) date.setMinutes(date.getMinutes() + 1);
  date.setSeconds(0, 0);
  return date;
}

/** 定时范围（最早 +5 分钟〔向上取整到分〕/ 最晚 +1 年）；在事件中调用，避免渲染期读 Date.now */
function computePublishBounds(): { min: string; max: string } {
  const now = Date.now();
  return {
    min: toLocalInput(ceilToMinute(now + SCHEDULE_MIN_AHEAD_MS)),
    max: toLocalInput(new Date(now + SCHEDULE_MAX_AHEAD_MS)),
  };
}

/** hh:mm（底部状态文案的“已保存”时间） */
function clockOf(time: number): string {
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 本地时间串 → RFC3339（非法值返回 undefined） */
function toIsoOrUndefined(local: string): string | undefined {
  if (!local) return undefined;
  const time = new Date(local).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/** 发布幂等 token：同一编辑器会话保持不变（旧草稿沿用服务端已存的 token） */
function makePublishToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `pt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function localDraftMigrated(): boolean {
  try {
    return localStorage.getItem(DRAFT_MIGRATED_KEY) === "1";
  } catch {
    return true;
  }
}

/** 服务端已接管草稿：删本机副本并写迁移标记 */
function markLocalDraftMigrated() {
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.setItem(DRAFT_MIGRATED_KEY, "1");
  } catch {
    /* 存储不可用时忽略：不影响服务端保存 */
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    const draft: Draft = {
      title: typeof parsed.title === "string" ? parsed.title : "",
      content: typeof parsed.content === "string" ? parsed.content : "",
      category: typeof parsed.category === "string" ? parsed.category : "",
      target: parsed.target === "guild" ? "guild" : "public",
      scheduled: Boolean(parsed.scheduled),
      publishAt: typeof parsed.publishAt === "string" ? parsed.publishAt : "",
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
    // 空草稿（只有空白标题 / 空正文）不恢复，避免每次进页面都弹提示
    if (!draft.title.trim() && !hasRichContent(draft.content)) return null;
    return draft;
  } catch {
    return null;
  }
}

function dropDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 同上 */
  }
}

/* ======================= 顶栏：左关闭 ✕ / 居中标题 ======================= */

function ComposeAppBar({ onClose }: { onClose: () => void }) {
  return (
    <div className="cp-appbar-wrap">
      <AppBar center plain title="发布帖子">
        <IconButton icon="close" label="关闭" onClick={onClose} />
      </AppBar>
    </div>
  );
}

/* ======================= 页面 ======================= */

export function ComposeScreen({ draftId }: { draftId?: string }) {
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { push, replace, pop } = useNav();

  // 本机旧草稿只在首次挂载时读一次：没有服务端草稿时用于初始值恢复与迁移
  const [restored] = useState<Draft | null>(() => readDraft());
  const [serverDraft, setServerDraft] = useState<PostDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(Boolean(draftId));
  const [draftError, setDraftError] = useState("");

  const [title, setTitle] = useState(draftId ? "" : restored?.title ?? "");
  const [content, setContent] = useState(draftId ? "" : restored?.content ?? "");
  const [target, setTarget] = useState<Target>(draftId ? "public" : restored?.target ?? "public");
  const [targetTouched, setTargetTouched] = useState(Boolean(draftId) || Boolean(restored));
  const [pubCategory, setPubCategory] = useState(
    !draftId && restored && PUBLIC_CATEGORY_KEYS.includes(restored.category) ? restored.category : PUBLIC_CATEGORY_KEYS[0] || "general",
  );
  const [guildCategory, setGuildCategory] = useState(!draftId && restored?.target === "guild" ? restored.category : "");
  const [scheduled, setScheduled] = useState(!draftId && Boolean(restored?.scheduled));
  const [publishAt, setPublishAt] = useState(draftId ? "" : restored?.publishAt ?? "");
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);

  // 服务端草稿：id / 保存状态 / 已保存时间
  const [draftIdState, setDraftIdState] = useState<string | null>(draftId || null);
  const [saveState, setSaveState] = useState<DraftSaveState>(draftId ? "saved" : "idle");
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const publishingRef = useRef(false);
  // 发布幂等 token：一次编辑器会话只生成一次；打开旧草稿时沿用服务端已存的 token
  const publishTokenRef = useRef<string>(makePublishToken());
  const draftIdRef = useRef<string | null>(draftId || null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const suppressedRef = useRef(false);
  const versionRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const markDirtyRef = useRef<() => void>(() => undefined);
  /** 本页是「新建」还是「继续编辑已有草稿」：后者不参与本机旧草稿迁移 */
  const openedExistingRef = useRef(Boolean(draftId));
  const migratingRef = useRef(false);
  titleRef.current = title;
  contentRef.current = content;

  // 当前用户的会馆归属（/users/:id 同时下发 guild），再取其自定义分类
  const userId = user?.id || "";
  const profileQuery = useQuery({
    queryKey: ["compose-profile", userId],
    queryFn: () => api.user(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
  const guild = profileQuery.data?.guild as { uuid?: string; slug?: string; name?: string; theme_color?: string } | null | undefined;
  /** 只有拿到 uuid 才能真正发到会馆（/users/:id 的 guild 缺字段时退回公共空间） */
  const guildUsable = Boolean(guild?.uuid);
  const guildSlug = guild?.slug || "";
  const guildQuery = useQuery({
    queryKey: ["compose-guild", guildSlug],
    queryFn: () => api.guild(guildSlug),
    enabled: !!guildSlug,
    staleTime: 5 * 60_000,
  });
  const guildCategories = useMemo<string[]>(() => {
    const list = guildQuery.data?.guild?.categories;
    if (!Array.isArray(list)) return [];
    return list.map((item: any) => String(item?.name || "")).filter(Boolean);
  }, [guildQuery.data]);

  // 打开草稿：只有作者本人能读（服务端按 user_id 过滤，其他人一律 404）
  // 正文要等加载完再挂载编辑器（RichEditor 只在首次挂载时读 value）
  useEffect(() => {
    if (!draftId) return;
    let alive = true;
    setDraftLoading(true);
    setDraftError("");
    api.getDraft(draftId)
      .then((res) => {
        if (!alive) return;
        const draft = res.draft;
        setServerDraft(draft);
        setTitle(draft.title || "");
        setContent(draft.content || "");
        const draftCategory = draft.category || "";
        setPubCategory(PUBLIC_CATEGORY_KEYS.includes(draftCategory) ? draftCategory : PUBLIC_CATEGORY_KEYS[0] || "general");
        setGuildCategory(draftCategory);
        setTargetTouched(true);
        setTarget(draft.guild_uuid ? "guild" : "public");
        // 旧草稿的定时时间超出当前可选范围时收敛到边界，避免“保存过但现在提交不了”
        if (draft.scheduled_at) {
          const date = new Date(draft.scheduled_at);
          if (!Number.isNaN(date.getTime())) {
            const live = computePublishBounds();
            const local = toLocalInput(date);
            setScheduled(true);
            setBounds(live);
            setPublishAt(local < live.min ? live.min : local > live.max ? live.max : local);
          }
        }
        // 旧草稿没有 token 时生成一个；有则沿用，保证刷新后再发布也能幂等
        if (draft.publish_token) publishTokenRef.current = draft.publish_token;
        const updated = draft.updated_at ? new Date(draft.updated_at).getTime() : NaN;
        setSavedAt(clockOf(Number.isFinite(updated) ? updated : Date.now()));
        setSaveState("saved");
      })
      .catch((reason) => {
        if (alive) setDraftError(reason instanceof Error ? reason.message : "草稿加载失败");
      })
      .finally(() => {
        if (alive) setDraftLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [draftId]);

  // 首次拿到会馆信息：默认发到会馆（与 Web 一致）；恢复草稿时以草稿里的选择为准
  useEffect(() => {
    if (!guildUsable || targetTouched) return;
    setTarget("guild");
    if (titleRef.current.trim() || hasRichContent(contentRef.current)) markDirtyRef.current();
  }, [guildUsable, targetTouched]);

  // 草稿里选过会馆、但当前拿不到会馆标识（退馆 / 接口异常）：退回公共空间，避免「发布到」无选中项
  useEffect(() => {
    if (target !== "guild" || guildUsable || !profileQuery.isFetched) return;
    setTarget("public");
  }, [target, guildUsable, profileQuery.isFetched]);

  // 草稿保存时的会馆与当前会馆不一致（换馆 / 退馆）：退回公共空间，避免静默改用别的会馆发布
  useEffect(() => {
    if (!serverDraft || !profileQuery.isFetched) return;
    const draftGuild = serverDraft.guild_uuid || "";
    if (!draftGuild) return;
    if (!guild?.uuid || guild.uuid !== draftGuild) setTarget("public");
  }, [serverDraft, profileQuery.isFetched, guild?.uuid]);

  useEffect(() => {
    if (guildCategories.length === 0) return;
    setGuildCategory((current) => (current && guildCategories.includes(current) ? current : guildCategories[0]));
  }, [guildCategories]);

  // 旧版本地草稿迁移到服务端；失败时保留本机内容，后续自动保存也能接管
  useEffect(() => {
    if (draftId || !user || localDraftMigrated()) return;
    const local = restored;
    if (!local) return;
    let alive = true;
    migratingRef.current = true;
    void (async () => {
      try {
        const created = await api.createDraft();
        if (!alive) return;
        const payload: PostDraftPayload = {
          title: local.title.trim(),
          content: local.content,
          category: local.category,
          ...(local.scheduled && local.publishAt ? { scheduled_at: toIsoOrUndefined(local.publishAt) } : {}),
        };
        await api.saveDraft(created.id, payload);
        if (!alive) return;
        draftIdRef.current = created.id;
        setDraftIdState(created.id);
        markLocalDraftMigrated();
        setSavedAt(clockOf(Date.now()));
        setSaveState("saved");
        showToast("本机草稿已同步到账号");
      } catch {
        if (alive) showToast("本机草稿同步失败，内容仍保留在本机", "error");
      } finally {
        migratingRef.current = false;
        // 迁移期间用户可能又改了内容：结束后补一轮自动保存
        if (alive && dirtyRef.current) void flushRef.current();
      }
    })();
    return () => {
      alive = false;
      migratingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // 有本机草稿且不需要迁移 → 进入页面时提示一次（正文已随编辑器挂载注入）
  useEffect(() => {
    if (restored && !draftId && localDraftMigrated()) showToast("已恢复草稿");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = title.trim().length > 0 || hasRichContent(content);
  // 会馆有自定义分类时用会馆分类；否则发到会馆时不带分类（对齐 Web 的隐藏规则）
  const categories = target === "guild" ? guildCategories : PUBLIC_CATEGORY_KEYS;
  const showCategory = categories.length > 0;
  const category = target === "guild" ? guildCategory : pubCategory;
  const categoryLabel = (key: string) => CATEGORY_LABELS[key] || key;

  /* ------------------------------ 服务端草稿自动保存 ------------------------------ */

  /** 当前表单快照（自动保存与发布共用） */
  const buildPayload = (): PostDraftPayload => {
    const guildUuid = target === "guild" && guildUsable ? guild?.uuid : undefined;
    const scheduledAt = scheduled ? toIsoOrUndefined(publishAt) : undefined;
    return {
      title: title.trim(),
      content,
      category: target === "guild" ? guildCategory : pubCategory,
      publish_token: publishTokenRef.current,
      ...(guildUuid ? { guild_uuid: guildUuid } : {}),
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
    };
  };

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** 立即落盘（无改动 / 空内容直接返回成功）；在途保存会登记 pending，避免并发 PUT 覆盖 */
  const flush = async (): Promise<boolean> => {
    if (suppressedRef.current) return true;
    // 本机草稿迁移中：等迁移结束（effect 的 finally 会补一次 flush），避免重复建草稿
    if (migratingRef.current) return false;
    if (savingRef.current) {
      pendingRef.current = true;
      return false;
    }
    if (!dirtyRef.current) return true;
    clearTimer();
    // 还没有草稿且没有任何内容：不创建空草稿
    if (!draftIdRef.current && !titleRef.current.trim() && !hasRichContent(contentRef.current)) {
      dirtyRef.current = false;
      if (mountedRef.current) setSaveState("idle");
      return true;
    }
    const version = versionRef.current;
    const payload = buildPayload();
    let id = draftIdRef.current;
    savingRef.current = true;
    if (mountedRef.current) {
      setSaveState("saving");
      setSaveError("");
    }
    try {
      if (!id) {
        const created = await api.createDraft();
        id = created.id;
        draftIdRef.current = id;
        if (mountedRef.current) setDraftIdState(id);
      }
      const res = await api.saveDraft(id, payload);
      if (suppressedRef.current) return true;
      // 服务端已接管：本机旧草稿副本可以删了（仅新建页；编辑已有草稿时不碰本机副本）
      if (!openedExistingRef.current) markLocalDraftMigrated();
      if (!mountedRef.current) return true;
      const savedTime = res?.saved_at ? new Date(res.saved_at).getTime() : NaN;
      setSavedAt(clockOf(Number.isFinite(savedTime) ? savedTime : Date.now()));
      if (versionRef.current === version) {
        dirtyRef.current = false;
        setSaveState("saved");
      } else {
        // 保存期间又有新改动：保持 dirty，稍后再存一轮
        dirtyRef.current = true;
        setSaveState("dirty");
        pendingRef.current = true;
      }
      return true;
    } catch (reason) {
      if (mountedRef.current) {
        if (reason instanceof ApiError && reason.status === 404) {
          // 草稿已在别处删除：清空 id，下一轮自动保存另存为新草稿（文字内容不丢）
          draftIdRef.current = null;
          setDraftIdState(null);
          dirtyRef.current = true;
          pendingRef.current = true;
          setSaveError("草稿已在别处删除，正在另存为新的草稿…");
        } else {
          setSaveError(reason instanceof Error ? reason.message : "自动保存失败");
        }
        setSaveState("error");
      }
      return false;
    } finally {
      savingRef.current = false;
      if (pendingRef.current && !suppressedRef.current) {
        pendingRef.current = false;
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          void flushRef.current();
        }, 300);
      }
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  /** 表单改动：标记 dirty 并重置 3 秒防抖 */
  const markDirty = () => {
    if (suppressedRef.current) return;
    dirtyRef.current = true;
    versionRef.current += 1;
    setSaveState((current) => (current === "saving" ? current : "dirty"));
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, 3000);
  };
  markDirtyRef.current = markDirty;

  /** 等待在途保存并确保最新内容落盘（发布 / 离开前调用） */
  const waitForIdle = async (): Promise<boolean> => {
    clearTimer();
    for (let index = 0; index < 40 && savingRef.current; index += 1) await sleep(100);
    if (dirtyRef.current) {
      const ok = await flushRef.current();
      if (!ok) return false;
    }
    for (let index = 0; index < 40 && savingRef.current; index += 1) await sleep(100);
    return !dirtyRef.current;
  };

  /** 永久停止自动保存（发布 / 主动离开后的导航前调用） */
  const suppress = () => {
    suppressedRef.current = true;
    dirtyRef.current = false;
    clearTimer();
  };

  const retrySave = () => {
    if (suppressedRef.current) return;
    dirtyRef.current = true;
    void flushRef.current();
  };

  // 卸载时清理定时器并最后尝试保存（SPA 内部返回同样适用）
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      if (dirtyRef.current && !suppressedRef.current) void flushRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 页面进入后台时尽力落盘（切后台 / 锁屏后可能被系统回收）
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------ 交互 ------------------------------ */

  const requestClose = useCallback(() => {
    if (busy || leaving) return;
    // 草稿还在加载 / 加载失败：编辑区不可用，直接退栈
    if (draftId && (draftLoading || draftError)) {
      pop();
      return;
    }
    // 没有内容也没有草稿（或内容已全部落盘）：直接离开
    if (!dirty && !draftIdRef.current) {
      dropDraft();
      pop();
      return;
    }
    if (draftIdRef.current && !dirtyRef.current) {
      pop();
      return;
    }
    setConfirmDiscard(true);
  }, [busy, leaving, draftId, draftLoading, draftError, dirty, pop]);

  // 系统返回键同样走“保存 / 丢弃”选择而不是直接退栈
  useEffect(() => registerBackHandler(() => {
    requestClose();
    return true;
  }), [requestClose]);

  /** 保存并离开：确保最新内容落盘，失败则留在页面提示重试 */
  const saveAndLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    const ok = await waitForIdle();
    if (!ok && (titleRef.current.trim() || hasRichContent(contentRef.current))) {
      setLeaving(false);
      showToast("草稿保存失败，请重试或丢弃后再离开", "error");
      return;
    }
    suppress();
    setConfirmDiscard(false);
    showToast("已保存到草稿箱");
    pop();
  };

  /** 丢弃草稿：删除服务端草稿（已在别处删除视为成功），再退出 */
  const discardDraft = async () => {
    if (leaving) return;
    setLeaving(true);
    // 先停掉自动保存，避免删除请求期间又把内容写回去
    suppress();
    const id = draftIdRef.current;
    if (id) {
      try {
        await api.deleteDraft(id);
      } catch (reason) {
        if (!(reason instanceof ApiError && reason.status === 404)) {
          // 删除失败：恢复自动保存并留在页面，内容不丢
          suppressedRef.current = false;
          dirtyRef.current = Boolean(titleRef.current.trim() || hasRichContent(contentRef.current));
          if (dirtyRef.current) void flushRef.current();
          setLeaving(false);
          showToast(reason instanceof Error ? reason.message : "草稿删除失败", "error");
          return;
        }
      }
    }
    dropDraft();
    setConfirmDiscard(false);
    pop();
  };

  const toggleScheduled = (on: boolean) => {
    setScheduled(on);
    setBounds(on ? computePublishBounds() : null);
    markDirty();
  };

  const submit = async () => {
    if (publishingRef.current || busy) return;
    const trimmed = title.trim();
    if (!trimmed) return showToast("还差一个标题", "error");
    if (!hasRichContent(content)) return showToast("正文还是空的", "error");
    if (contentByteLength(content) > MAX_POST_CONTENT_BYTES) return showToast("正文过长（上限 256KB）", "error");
    if (target === "guild" && !guildUsable) return showToast("会馆信息缺失，请刷新后重试", "error");

    // 定时发布：校验范围（本地时间 → UTC ISO，与服务端 RFC3339 口径一致）
    let scheduledAt: string | undefined;
    if (scheduled) {
      if (!publishAt) return showToast("请选择定时发布时间", "error");
      const live = computePublishBounds();
      setBounds(live);
      const value = publishAt < live.min ? live.min : publishAt;
      if (value !== publishAt) setPublishAt(value);
      const time = new Date(value).getTime();
      if (!Number.isFinite(time)) return showToast("定时发布时间无效", "error");
      if (time > Date.now() + SCHEDULE_MAX_AHEAD_MS) return showToast("定时发布时间不能超过 1 年", "error");
      scheduledAt = new Date(time).toISOString();
    }

    publishingRef.current = true;
    setBusy(true);
    try {
      // 先把在途/待发的自动保存落地，避免发布后又被旧草稿覆盖（发布本身也带全量内容）
      await waitForIdle();
      const payload: PostDraftPayload = { ...buildPayload(), title: trimmed, ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) };
      let postId: string | null = null;
      const currentDraftId = draftIdRef.current;
      if (currentDraftId) {
        try {
          const res = await api.publishDraft(currentDraftId, payload);
          postId = String(res.id);
        } catch (reason) {
          // 草稿已被其他端删除：内容还在本地，直接按新帖发布，避免用户白写
          if (!(reason instanceof ApiError) || reason.status !== 404) throw reason;
        }
      }
      if (!postId) {
        const res = await api.createPost({
          title: trimmed,
          content,
          category: category || undefined,
          guild_uuid: target === "guild" ? guild?.uuid : undefined,
          published_at: scheduledAt,
        });
        postId = String(res.id);
      }
      suppress();
      markLocalDraftMigrated();
      showToast(scheduled ? "已设置定时发布" : "发布成功");
      // 离开编辑页并直接进入新帖（返回落在广场，不会回到已清空的编辑器）
      replace("post", { id: postId });
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "发布失败", "error");
    } finally {
      publishingRef.current = false;
      setBusy(false);
    }
  };

  /* ------------------------------ 未登录 ------------------------------ */
  if (!user) {
    return (
      <Screen appbar={<ComposeAppBar onClose={pop} />} bodyClassName="cp-body">
        <Empty
          icon="user"
          title="登录后才能发帖"
          hint="登录后可以发布帖子、插入图片，也可以定时发布到会馆。"
          action={<button className="m-btn m-btn--primary" onClick={() => push("auth")}>去登录</button>}
        />
      </Screen>
    );
  }

  /* ------------------------------ 草稿加载中 / 加载失败 ------------------------------ */
  if (draftId && draftLoading) {
    return (
      <Screen appbar={<ComposeAppBar onClose={pop} />} bodyClassName="cp-body">
        <div className="cp-editor-loading" style={{ margin: 16 }}>
          <span className="m-spinner" />
          <span>正在加载草稿…</span>
        </div>
      </Screen>
    );
  }
  if (draftId && draftError) {
    return (
      <Screen appbar={<ComposeAppBar onClose={pop} />} bodyClassName="cp-body">
        <Empty
          icon="alert"
          title="草稿不可用"
          hint={`${draftError}。草稿只能由作者本人读取，它可能已在其他设备被删除。`}
          action={<button className="m-btn m-btn--primary" onClick={() => replace("compose")}>新建帖子</button>}
        />
      </Screen>
    );
  }

  const segItems: { key: Target; label: React.ReactNode }[] = guildUsable && guild
    ? [
        { key: "public", label: "公共空间" },
        { key: "guild", label: `我的会馆（${guild.name}）` },
      ]
    : [{ key: "public", label: "公共空间" }];

  const status = busy
    ? "正在发布…"
    : saveState === "saving"
      ? "正在保存草稿…"
      : saveState === "error"
        ? saveError || "自动保存失败"
        : saveState === "dirty"
          ? "有新的更改，3 秒后自动保存"
          : saveState === "saved"
            ? savedAt ? `已保存 ${savedAt}` : "草稿已保存"
            : "草稿会自动保存到账号";

  return (
    <Screen
      appbar={<ComposeAppBar onClose={requestClose} />}
      bodyClassName="cp-body"
      footer={
        <div className="m-actionbar cp-actionbar">
          {saveState === "error" && !busy ? (
            <button type="button" className="cp-status st-link" onClick={retrySave}>
              {status} · 点击重试
            </button>
          ) : (
            <div className="cp-status" role="status" aria-live="polite">{status}</div>
          )}
          <button type="button" className="m-btn m-btn--primary cp-submit" disabled={busy} onClick={() => void submit()}>
            {busy ? "发布中…" : scheduled ? "定时发布" : "发布"}
          </button>
        </div>
      }
    >
      <div className="cp-form">
        {/* 1. 大标题 */}
        <div className="cp-title-block">
          <input
            className="cp-title"
            type="text"
            value={title}
            placeholder="起个标题…"
            maxLength={TITLE_LIMIT}
            aria-label="帖子标题"
            onChange={(event) => {
              setTitle(event.target.value);
              markDirty();
            }}
          />
          <div className="cp-count">{title.length}/{TITLE_LIMIT}</div>
        </div>

        {/* 2. 分隔线 */}
        <div className="m-divider cp-divider" />

        {/* 3. 分类 */}
        {showCategory ? (
          <section className="cp-block">
            <div className="cp-label">分类</div>
            <div className="cp-cats" role="radiogroup" aria-label="帖子分类">
              {categories.map((key) => {
                const active = key === category;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`cp-cat ${active ? "on" : ""}`.trim()}
                    onClick={() => {
                      if (target === "guild") setGuildCategory(key);
                      else setPubCategory(key);
                      markDirty();
                    }}
                  >
                    {active ? <Icon name="check" size={13} /> : null}
                    <span>{categoryLabel(key)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* 4. 发布到 */}
        <section className="cp-block">
          <div className="cp-label">发布到</div>
          {segItems.length > 1 ? (
            <Segmented
              className="cp-seg"
              items={segItems}
              value={target}
              onChange={(key) => {
                setTarget(key);
                setTargetTouched(true);
                markDirty();
              }}
            />
          ) : (
            <div className="cp-static-target">
              <Icon name="globe" size={17} />
              <span>公共空间</span>
              <span className="cp-static-target-hint">所有访客可见</span>
            </div>
          )}
          {target === "guild" && guildUsable && guild ? (
            <p className="cp-hint">将发布到会馆「{guild.name}」，所有访客可见</p>
          ) : null}
          {profileQuery.isError ? (
            <p className="cp-hint cp-hint--warn">会馆信息加载失败，当前按公共空间发布，请稍后重试</p>
          ) : null}
        </section>

        {/* 5. 正文（占满剩余空间） */}
        <div className="cp-editor">
          <Suspense
            fallback={
              <div className="cp-editor-loading">
                <span className="m-spinner" />
                <span>编辑器加载中…</span>
              </div>
            }
          >
            <RichEditor
              value={content}
              onChange={(html) => {
                setContent(html);
                markDirty();
              }}
              placeholder="写下你的想法…"
              minHeight={260}
              scene="post_image"
              toolbar="full"
            />
          </Suspense>
        </div>

        {/* 6. 定时发布 */}
        <Cell
          icon="clock"
          label="定时发布"
          sub={scheduled ? "到点自动发布" : "可选，到点自动发布"}
          chevron={false}
          onClick={() => toggleScheduled(!scheduled)}
          right={<span className={`cp-switch ${scheduled ? "on" : ""}`.trim()} aria-hidden="true"><i /></span>}
        />
        {scheduled ? (
          <div className="cp-datetime">
            <input
              type="datetime-local"
              className="m-input cp-datetime-input"
              aria-label="定时发布时间"
              value={publishAt}
              min={bounds?.min}
              max={bounds?.max}
              onChange={(event) => {
                setPublishAt(event.target.value);
                markDirty();
              }}
            />
            <p className="cp-hint">最早为 5 分钟后、最晚 1 年内；到点前该帖仅自己可见。</p>
          </div>
        ) : null}

        {/* 发帖须知（默认收起） */}
        <div className={`cp-notice ${noticeOpen ? "open" : ""}`.trim()}>
          <button type="button" className="cp-notice-toggle" aria-expanded={noticeOpen} onClick={() => setNoticeOpen((open) => !open)}>
            <Icon name="shield" size={15} />
            <span>发帖须知</span>
            <Icon name="down" size={15} className="cp-notice-arrow" />
          </button>
          {noticeOpen ? (
            <ul className="cp-notice-list">
              {COMPLIANCE.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : null}
        </div>
      </div>

      {/* 离开编辑：草稿已自动保存到账号，也可以直接丢弃 */}
      <Sheet
        open={confirmDiscard}
        title="离开编辑"
        onClose={() => {
          if (!leaving) setConfirmDiscard(false);
        }}
        footer={
          <>
            <button type="button" className="m-btn m-btn--ghost" disabled={leaving} onClick={() => void discardDraft()}>
              丢弃草稿
            </button>
            <button type="button" className="m-btn m-btn--primary" disabled={leaving} onClick={() => void saveAndLeave()}>
              {leaving ? "保存中…" : "保存并离开"}
            </button>
          </>
        }
      >
        <p className="m-text">
          编辑内容会自动保存到「草稿箱」，未发布前只有你能看到。选择「丢弃草稿」会删除这份草稿，无法恢复。
        </p>
      </Sheet>
    </Screen>
  );
}
