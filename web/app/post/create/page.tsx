"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import GlobalLoading from "@/components/GlobalLoading";
import RichTextEditor from "@/components/editor/RichTextEditor";
import SchedulePicker from "@/components/post/SchedulePicker";
import { useToast } from "@/components/Toast";
import BackButton from "@/components/ui/BackButton";
import {
  postApi,
  postDraftApi,
  userApi,
  guildApi,
  ApiException,
  GuildMembership,
  PostDraft,
  PostDraftPayload,
} from "@/lib/api";
import { POST_CATEGORIES, contrastText, themeColor, themeInk, themeTint } from "@/lib/constants";
import { useStore } from "@/lib/store";
import { useDraftAutosave, type DraftSaveState } from "@/lib/use-draft-autosave";

const COMPLIANCE = [
  "遵守中华人民共和国相关法律法规，不得发布违法违规内容",
  "禁止涉及政治敏感、涉黄涉暴、血腥恐怖、毒品赌博等内容",
  "禁止人身攻击、谩骂侮辱、恶意引战、网络暴力等行为",
  "禁止发布广告、 spam、外链刷量、引流等垃圾信息",
  "禁止泄露他人或自己的隐私信息（真实姓名、电话、地址等）",
  "禁止侵犯他人知识产权，转载请注明出处或获得授权",
  "内容应与论坛主题（罗小黑战记及二次元文化）相关，鼓励友善交流",
  "违反以上规定的帖子将被删除，情节严重者将封禁账号",
];

/** 富文本是否为空（无文本且无图片/引用节点）：编辑器空文档序列化为 <p></p> */
function hasRichContent(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return !!text || /<img\b/i.test(html) || /data-embed=/i.test(html);
}

/** 本地时区 YYYY-MM-DDTHH:mm 时间串（定时选择器与 min/max 共用口径） */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 定时发布时间约束：最早当前时间 +5 分钟，最晚 +1 年 */
const SCHEDULE_MIN_AHEAD_MS = 5 * 60 * 1000;
const SCHEDULE_MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** 向上取整到下一整分钟（含秒/毫秒时进位）：分钟粒度下保证 min 提交时依旧有效 */
function ceilToMinute(t: number): Date {
  const d = new Date(t);
  if (d.getSeconds() > 0 || d.getMilliseconds() > 0) d.setMinutes(d.getMinutes() + 1);
  d.setSeconds(0, 0);
  return d;
}

/** 计算定时范围（最早 +5 分钟〔向上取整到分〕/ 最晚 +1 年）；在事件/effect 中调用，避免渲染期读 Date.now */
function computePublishBounds() {
  const now = Date.now();
  return {
    min: toLocalInput(ceilToMinute(now + SCHEDULE_MIN_AHEAD_MS)),
    max: toLocalInput(new Date(now + SCHEDULE_MAX_AHEAD_MS)),
  };
}

/** 本地时间串 → RFC3339（非法值返回 undefined） */
function toIsoOrUndefined(local: string): string | undefined {
  if (!local) return undefined;
  const t = new Date(local).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** 只显示时分（保存时间/定时提示用） */
function fmtClock(v?: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const PUBLIC_CATEGORY_KEYS = new Set(POST_CATEGORIES.map((c) => c.key));

/** 与服务端一致的正文原始字节上限（256KB） */
const MAX_POST_CONTENT_BYTES = 256 * 1024;

/** UTF-8 字节数（用于提交前提示，服务端仍会二次校验） */
function contentByteLength(html: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(html).length;
  return html.length * 3;
}

/** 未登录路由守卫：等待会话加载完成后跳转登录页（避免未登录进入发帖界面） */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loadingUser } = useStore();

  useEffect(() => {
    if (!loadingUser && !user) router.replace("/auth");
  }, [loadingUser, user, router]);

  if (loadingUser || !user) {
    return (
      <div className="route-loading">
        <GlobalLoading />
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * 发帖页（useSearchParams 需在 Suspense 内，遵循 Next.js App Router 规范）：
 * 发布到（公共空间 / 我的会馆）+ 分类联动 + 富文本编辑器（TipTap，提交 HTML）。
 * ?guild=slug 预选会馆；?draft=id 继续编辑草稿（仅作者本人可读）。
 * 所有编辑默认自动保存为草稿，点「发布」才对外可见。
 */
export default function PostCreatePage() {
  return (
    <RequireAuth>
      <Suspense
        fallback={
          <div className="route-loading">
            <GlobalLoading />
          </div>
        }
      >
        <PostCreateEntry />
      </Suspense>
    </RequireAuth>
  );
}

/** 入口：区分「新建」与「继续编辑草稿」 */
function PostCreateEntry() {
  const params = useSearchParams();
  const draftId = params.get("draft") || "";
  const guildSlug = params.get("guild") || "";
  if (draftId) return <DraftLoader key={draftId} id={draftId} guildSlug={guildSlug} />;
  return <PostCreateEditor initialDraftId={null} initialDraft={null} guildSlug={guildSlug} />;
}

/** 草稿加载器：只有作者本人能读到（服务端按 user_id 过滤，其他人一律 404） */
function DraftLoader({ id, guildSlug }: { id: string; guildSlug: string }) {
  const [draft, setDraft] = useState<PostDraft | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    postDraftApi
      .get(id)
      .then((r) => {
        if (alive) setDraft(r.draft);
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiException ? e.message : "草稿加载失败");
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return (
      <>
        <div className="post-create-container">
          <div className="post-create-header">
            <BackButton className="post-create-back" />
            <h1 className="post-create-title">草稿不可用</h1>
            <div style={{ width: 60 }}></div>
          </div>
          <div className="post-create-form post-draft-error-card">
            <i className="fa fa-exclamation-circle"></i>
            <p>{error}</p>
            <p className="post-draft-error-hint">草稿只能由作者本人读取，它可能已在其他设备被删除。</p>
            <div className="form-actions">
              <Link className="btn-submit" href="/post/create">
                新建帖子
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!draft) {
    return (
      <div className="route-loading">
        <GlobalLoading />
      </div>
    );
  }

  return (
    <PostCreateEditor
      key={draft.id}
      initialDraftId={draft.id}
      initialDraft={draft}
      guildSlug={guildSlug}
    />
  );
}

/** 草稿保存状态条 */
function DraftStatus({
  state,
  savedAt,
  error,
  onRetry,
}: {
  state: DraftSaveState;
  savedAt: string | null;
  error: string;
  onRetry: () => void;
}) {
  if (state === "saving") {
    return (
      <span className="post-draft-status is-saving">
        <i className="fa fa-spinner fa-spin"></i> 正在保存草稿…
      </span>
    );
  }
  if (state === "dirty") {
    return (
      <span className="post-draft-status is-dirty">
        <i className="fa fa-pencil"></i> 有新的更改，3 秒后自动保存…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="post-draft-status is-saved">
        <i className="fa fa-check"></i> 已自动保存{savedAt ? ` · ${fmtClock(savedAt)}` : ""}
      </span>
    );
  }
  if (state === "error") {
    return (
      <button type="button" className="post-draft-status is-error" onClick={onRetry}>
        <i className="fa fa-exclamation-circle"></i> {error || "自动保存失败"}，点此重试
      </button>
    );
  }
  if (savedAt) {
    return (
      <span className="post-draft-status is-saved">
        <i className="fa fa-check"></i> 草稿已保存 · {fmtClock(savedAt)}
      </span>
    );
  }
  return (
    <span className="post-draft-status is-idle">
      <i className="fa fa-cloud"></i> 编辑内容会自动保存为草稿，发布后才对外可见
    </span>
  );
}

function PostCreateEditor({
  initialDraftId,
  initialDraft,
  guildSlug,
}: {
  initialDraftId: string | null;
  initialDraft: PostDraft | null;
  guildSlug: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const initialCategory = initialDraft?.category || "";
  // 草稿的定时时间在首次挂载时算一次；草稿编辑器只会在客户端加载后挂载（DraftLoader 先请求），
  // 因此这里读 Date.now 不会造成 SSR/hydration 不一致。
  const initialSchedule = useMemo(() => {
    const raw = initialDraft?.scheduled_at;
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const live = computePublishBounds();
    const local = toLocalInput(d);
    const value = local < live.min ? live.min : local > live.max ? live.max : local;
    return { bounds: live, value, adjusted: value !== local };
  }, [initialDraft]);

  const [title, setTitle] = useState(initialDraft?.title || "");
  const [content, setContent] = useState(initialDraft?.content || "");
  const [pubCat, setPubCat] = useState(PUBLIC_CATEGORY_KEYS.has(initialCategory) ? initialCategory : POST_CATEGORIES[0].key);
  const [guildCat, setGuildCat] = useState(initialCategory);
  const [guildCats, setGuildCats] = useState<string[]>([]);
  const [target, setTarget] = useState<"public" | "guild">("public");
  const [guild, setGuild] = useState<GuildMembership | null>(null);
  const [guildFallback, setGuildFallback] = useState(false);
  const [membershipError, setMembershipError] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  // 定时发布（可选）：开关 + 日期/时间选择器（本地时间；提交转 UTC ISO）
  const [scheduled, setScheduled] = useState(!!initialSchedule);
  const [publishAt, setPublishAt] = useState(initialSchedule?.value || "");
  const [publishBounds, setPublishBounds] = useState<{ min: string; max: string } | null>(initialSchedule?.bounds || null);
  const [scheduleAdjusted, setScheduleAdjusted] = useState(!!initialSchedule?.adjusted);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);
  // 防双击「发布」造成重复帖子（第二条请求会因草稿已删除而走新建兜底）
  const publishingRef = useRef(false);
  // 会馆恢复后，若用户在加载期间已经写了内容，补一次落盘让 target/guild 与 UI 一致
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  useEffect(() => {
    titleRef.current = title;
    contentRef.current = content;
  });

  // 自动保存：快照函数每次渲染后刷新，3 秒防抖由 hook 统一处理
  const autosave = useDraftAutosave({
    initialDraftId,
    getPayload: (): PostDraftPayload => {
      const category = target === "guild" ? guildCat : pubCat;
      const guildUuid = target === "guild" && guild ? guild.uuid : "";
      const scheduledAt = scheduled && publishAt ? toIsoOrUndefined(publishAt) : undefined;
      return {
        title: title.trim(),
        content,
        category,
        ...(guildUuid ? { guild_uuid: guildUuid } : {}),
        ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      };
    },
    hasContent: () => title.trim().length > 0 || hasRichContent(content),
  });

  // 会馆归属：新帖默认发到已加入会馆；草稿按保存时的 guild_uuid 恢复，会馆变了则回退公共空间
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await userApi.me();
        if (!alive) return;
        setMembershipError(false);
        if (!r.guild) {
          if (initialDraft?.guild_uuid) setGuildFallback(true);
          return;
        }
        setGuild(r.guild);
        const d = await guildApi.detail(r.guild.slug);
        if (!alive) return;
        const names = (d.guild.categories || []).map((c) => c.name);
        setGuildCats(names);
        let nextTarget: "public" | "guild" = "public";
        if (initialDraft) {
          const draftGuild = initialDraft.guild_uuid || "";
          nextTarget = draftGuild && draftGuild === r.guild.uuid ? "guild" : "public";
          if (draftGuild && draftGuild !== r.guild.uuid) setGuildFallback(true);
        } else if (!guildSlug || guildSlug === r.guild.slug) {
          // 未指定会馆：沿用「已加入则默认发到会馆」；指定了非本人所属会馆：退回公共空间
          nextTarget = "guild";
        }
        if (nextTarget === "guild") {
          setGuildCat(names.includes(initialCategory) ? initialCategory : names[0] || "");
        } else {
          if (initialDraft) {
            setPubCat(PUBLIC_CATEGORY_KEYS.has(initialCategory) ? initialCategory : POST_CATEGORIES[0].key);
          }
          setGuildCat(names[0] || "");
        }
        setTarget(nextTarget);
        // 新帖：若会馆加载期间已经输入内容，标记一次脏数据，让草稿保存到正确的空间/分类
        if (!initialDraft && (titleRef.current.trim() || hasRichContent(contentRef.current))) {
          autosave.markDirty();
        }
      } catch {
        // 会馆信息加载失败：保持公共空间，但明确提示，避免静默把会馆稿发到公共空间
        setMembershipError(true);
        if (initialDraft?.guild_uuid) setGuildFallback(true);
      }
    })();
    return () => {
      alive = false;
    };
    // initialCategory 由 initialDraft 派生，二者同步；guildSlug 变化时需要重新匹配
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildSlug, initialDraft]);

  // 放弃草稿的二次确认计时器清理
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    };
  }, []);

  /** 切换定时发布：开启时计算时间范围（最早 +5 分钟 / 最晚 +1 年） */
  const toggleScheduled = (on: boolean) => {
    setScheduled(on);
    if (on) setPublishBounds(computePublishBounds());
    setScheduleAdjusted(false);
    autosave.markDirty();
  };

  const category = target === "guild" ? guildCat : pubCat;
  const chips = target === "guild" ? guildCats : POST_CATEGORIES.map((c) => c.key);
  const theme = themeColor(guild?.theme_color);
  const themeFg = contrastText(theme);
  const inkStyle = { "--guild-ink": themeInk(theme) } as React.CSSProperties;
  const editingDraft = !!autosave.draftId || !!initialDraftId;
  const canDiscard = editingDraft || hasRichContent(content) || !!title.trim();

  const submit = async () => {
    if (publishingRef.current || discarding) return;
    if (!title.trim()) return setErr("请输入标题");
    // 编辑器空文档序列化为 <p></p>，故按「无文本且无图片/引用节点」判空
    if (!hasRichContent(content)) return setErr("请输入内容");
    if (contentByteLength(content) > MAX_POST_CONTENT_BYTES) return setErr("正文过长（上限 256KB）");
    const imgCount = (content.match(/<img\b/gi) || []).length;
    const embedCount = (content.match(/data-embed=/gi) || []).length;
    if (imgCount > 60 || embedCount > 30) return setErr("图片/引用数量过多");
    // 目标为会馆时必须携带会馆 uuid：缺失说明会馆数据异常，明确报错阻断，
    // 避免静默降级成发布到公共空间
    if (target === "guild" && !guild?.uuid) {
      toast("会馆标识缺失，请刷新重试", "error");
      return;
    }
    // 定时发布：校验范围（客户端本地时间 → UTC ISO，与服务端 RFC3339 口径一致）
    let publishedAt: string | undefined;
    if (scheduled) {
      if (!publishAt) return setErr("请选择定时发布时间");
      // 最早时间随「当前时间」实时前移：刷新边界，并把已选值收敛到最新的最早可选时间，
      // 避免「选择时合法、提交时已过期」的边界死区（选今天 → 立即提交被拒）。
      const live = computePublishBounds();
      setPublishBounds(live);
      const value = publishAt < live.min ? live.min : publishAt;
      if (value !== publishAt) setPublishAt(value);
      const t = new Date(value).getTime();
      if (!Number.isFinite(t)) return setErr("定时发布时间无效");
      if (t > Date.now() + SCHEDULE_MAX_AHEAD_MS) return setErr("定时发布时间不能超过 1 年");
      publishedAt = new Date(t).toISOString();
    }
    publishingRef.current = true;
    setBusy(true);
    setErr("");
    try {
      // 先把在途/待发的自动保存落地，避免发布后又被旧草稿覆盖（发布本身也带全量内容）
      await autosave.waitForIdle();
      const categoryValue = target === "guild" ? guildCat : pubCat;
      const guildUuid = target === "guild" && guild ? guild.uuid : undefined;
      const publishPayload: PostDraftPayload = {
        title: title.trim(),
        content,
        category: categoryValue,
        ...(guildUuid ? { guild_uuid: guildUuid } : {}),
        ...(publishedAt ? { scheduled_at: publishedAt } : {}),
      };
      const currentDraftId = autosave.getDraftId();
      if (currentDraftId) {
        try {
          const r = await postDraftApi.publish(currentDraftId, publishPayload);
          autosave.suppress();
          router.push(`/post/${r.id}`);
          return;
        } catch (e) {
          // 草稿已被其他端删除：内容还在本地，直接按新帖发布，避免用户白写
          if (!(e instanceof ApiException) || e.status !== 404) throw e;
        }
      }
      // 草稿已被别处删除：清理可能在恢复过程中新建的空壳草稿，再按新帖发布
      const recoveredDraftId = autosave.getDraftId();
      const r = await postApi.create(title.trim(), content, categoryValue, guildUuid, publishedAt);
      autosave.suppress();
      if (recoveredDraftId) {
        try {
          await postDraftApi.remove(recoveredDraftId);
        } catch {
          /* 旧 id 已删/新草稿已不存在都无需处理 */
        }
      }
      router.push(`/post/${r.id}`);
    } catch (e) {
      setErr(e instanceof ApiException ? e.message : "发布失败");
    } finally {
      publishingRef.current = false;
      setBusy(false);
    }
  };

  /** 取消：尽量把内容存成草稿再离开；保存失败时留在页面提示重试 */
  const cancel = async () => {
    if (discarding) return;
    if (!canDiscard) {
      router.back();
      return;
    }
    const ok = await autosave.waitForIdle();
    if (!ok && (hasRichContent(content) || title.trim())) {
      toast("草稿自动保存失败，请点击状态条重试后再离开", "error");
      return;
    }
    // 内容已落盘：停止自动保存并放行 beforeunload，再回论坛广场。
    // 不要在这里更新地址栏（replaceState 会被 Next App Router 观察到并重挂编辑器）。
    autosave.suppress();
    toast("已保存为草稿", "success");
    router.replace("/forum");
  };

  /** 放弃草稿：二次确认后删除服务端草稿（没有草稿记录时直接离开） */
  const discardDraft = async () => {
    if (discarding) return;
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = window.setTimeout(() => setConfirmDiscard(false), 4000);
      return;
    }
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    setDiscarding(true);
    // 暂停而不是永久停止：删除失败时要能恢复自动保存，避免编辑器进入「假保存」状态
    autosave.pause();
    const id = autosave.getDraftId();
    if (id) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10000);
      try {
        await postDraftApi.remove(id, controller.signal);
      } catch (e) {
        // 已在别处删除视为成功
        if (!(e instanceof ApiException) || e.status !== 404) {
          autosave.resume();
          setDiscarding(false);
          setConfirmDiscard(false);
          toast(`${e instanceof ApiException ? e.message : "草稿删除失败"}；已恢复自动保存`, "error");
          return;
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }
    autosave.suppress();
    toast("已放弃草稿", "success");
    router.push("/forum");
    setDiscarding(false);
  };

  return (
    <>
      <div className="post-create-container">
        <div className="post-create-header">
          <BackButton className="post-create-back" onClick={() => void cancel()} />
          <h1 className="post-create-title">{initialDraftId ? "编辑草稿" : "发布新帖子"}</h1>
          <div style={{ width: 60 }}></div>
        </div>

        <div className="post-create-form">
          {/* 草稿状态条：让「自动保存」始终可见、可重试 */}
          <div className="post-draft-bar">
            <span className={`post-draft-chip ${editingDraft ? "is-draft" : ""}`}>
              <i className="fa fa-file-text-o"></i> {editingDraft ? "草稿" : "自动保存"}
            </span>
            <div className="post-draft-status-wrap" role="status" aria-live="polite">
              <DraftStatus
                state={autosave.saveState}
                savedAt={autosave.savedAt || initialDraft?.updated_at || null}
                error={autosave.saveError}
                onRetry={autosave.retry}
              />
            </div>
            {canDiscard && (
              <button
                type="button"
                className={`post-draft-discard ${confirmDiscard ? "is-confirming" : ""}`}
                onClick={discardDraft}
              >
                <i className={`fa ${confirmDiscard ? "fa-exclamation-triangle" : "fa-trash-o"}`}></i>
                {confirmDiscard ? "确定放弃？" : "放弃草稿"}
              </button>
            )}
          </div>

          {/* 发布到 */}
          <div className="form-group">
            <label className="form-label">发布到</label>
            <div className="post-target-segmented">
              <button
                className={`post-target-btn ${target === "public" ? "active" : ""}`}
                style={target === "public" ? { background: "var(--color-primary)" } : undefined}
                onClick={() => {
                  setTarget("public");
                  autosave.markDirty();
                }}
              >
                <i className="fa fa-globe"></i> 公共空间
              </button>
              {guild && (
                <button
                  className={`post-target-btn ${target === "guild" ? "active" : ""}`}
                  style={
                    target === "guild"
                      ? ({ background: theme, borderColor: theme, "--guild-btn-fg": themeFg } as React.CSSProperties)
                      : undefined
                  }
                  onClick={() => {
                    setTarget("guild");
                    autosave.markDirty();
                  }}
                >
                  <i className="fa fa-home"></i> 我的会馆（{guild.name}）
                </button>
              )}
            </div>
            {target === "guild" && guild && (
              <p className="post-target-hint theme-ink" style={inkStyle}>
                <i className="fa fa-info-circle"></i> 帖子将发布到会馆「{guild.name}」，所有访客可见
              </p>
            )}
            {guildFallback && (
              <p className="post-target-hint post-target-hint-warn">
                <i className="fa fa-info-circle"></i> 草稿原先的会馆已不可用，将发布到公共空间
              </p>
            )}
            {membershipError && (
              <p className="post-target-hint post-target-hint-warn">
                <i className="fa fa-exclamation-circle"></i> 会馆信息加载失败，当前按公共空间发布；请刷新页面重试
              </p>
            )}
          </div>

          {/* 分类（会馆无自定义分类时隐藏） */}
          {chips.length > 0 && (
            <div className="form-group">
              <label className="form-label">帖子分类</label>
              <div className="form-category-select" id="form-category-select">
                {chips.map((key) => {
                  const label = target === "guild" ? key : POST_CATEGORIES.find((c) => c.key === key)?.label || key;
                  const active = category === key;
                  return (
                    <button
                      key={key}
                      className={`category-chip ${active ? "active" : ""}`}
                      data-value={key}
                      style={active && target === "guild" ? { background: theme, color: themeFg } : undefined}
                      onClick={() => {
                        if (target === "guild") setGuildCat(key);
                        else setPubCat(key);
                        autosave.markDirty();
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">帖子标题</label>
            <input
              type="text"
              className="form-input"
              id="post-title-input"
              placeholder="请输入标题..."
              maxLength={100}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                autosave.markDirty();
              }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">帖子内容</label>
            <RichTextEditor
              value={content}
              onChange={(html) => {
                setContent(html);
                autosave.markDirty();
              }}
              placeholder="在此输入正文…"
            />
          </div>

          {/* 定时发布（可选） */}
          <div className="form-group">
            <label className="post-schedule-toggle">
              <input type="checkbox" checked={scheduled} onChange={(e) => toggleScheduled(e.target.checked)} />
              <i className="fa fa-clock-o"></i> 定时发布
            </label>
            {scheduled && publishBounds && (
              <>
                <SchedulePicker
                  value={publishAt}
                  min={publishBounds.min}
                  max={publishBounds.max}
                  onChange={(v) => {
                    setPublishAt(v);
                    setScheduleAdjusted(false);
                    autosave.markDirty();
                  }}
                />
                <p className="post-schedule-hint">
                  <i className="fa fa-info-circle"></i> 到点后自动发布：最早为当前时间 5 分钟后，最晚 1 年内；未到时间前仅自己可见。
                </p>
                {scheduleAdjusted && (
                  <p className="post-schedule-hint post-schedule-hint-warn">
                    <i className="fa fa-exclamation-circle"></i> 草稿里暂存的定时时间已过（或超出范围），已调整为可选范围，请确认。
                  </p>
                )}
              </>
            )}
          </div>

          {err && <p style={{ color: "#ef4444", margin: "12px 0 0" }}>{err}</p>}

          <div className="form-actions">
            <button className="btn-cancel" disabled={discarding} onClick={cancel}>取消</button>
            <button
              className="btn-submit"
              id="post-submit-btn"
              disabled={busy || discarding}
              onClick={submit}
              style={target === "guild" ? { background: theme, color: themeFg } : undefined}
            >
              <i className="fa fa-paper-plane"></i> {busy ? "发布中..." : scheduled ? "定时发布" : "发布"}
            </button>
          </div>

          {/* 发帖须知（默认收起） */}
          <div className={`post-compliance-collapse ${noticeOpen ? "open" : ""}`} style={noticeOpen ? { background: themeTint(theme, "14") } : undefined}>
            <button type="button" className="post-compliance-toggle" onClick={() => setNoticeOpen(!noticeOpen)} aria-expanded={noticeOpen}>
              <i className="fa fa-shield"></i>
              <span>发帖须知</span>
              <i className={`fa ${noticeOpen ? "fa-chevron-up" : "fa-chevron-down"} post-compliance-arrow`}></i>
            </button>
            {noticeOpen && (
              <ul className="post-compliance-list">
                {COMPLIANCE.map((li, i) => (
                  <li key={i}>{li}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
