import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { registerBackHandler } from "../lib/back";
import { AppBar, Cell, Confirm, Empty, IconButton, Screen, Segmented } from "../components/mobile";
import { Icon } from "../components/icons";
import { CATEGORY_LABELS } from "../lib/format";

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

/** 本地草稿（只存在设备上，发布成功 / 主动丢弃时清空） */
const DRAFT_KEY = "yj.compose.draft.v1";

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

function writeDraft(draft: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* 隐私模式 / 存储已满时静默降级：本次编辑仍然可以发布 */
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

export function ComposeScreen() {
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { push, replace, pop } = useNav();

  // 草稿只在首次挂载时读一次：正文要随编辑器首次挂载一起注入，不能等 effect 补
  const [restored] = useState<Draft | null>(() => readDraft());

  const [title, setTitle] = useState(restored?.title ?? "");
  const [content, setContent] = useState(restored?.content ?? "");
  const [target, setTarget] = useState<Target>(restored?.target ?? "public");
  const [targetTouched, setTargetTouched] = useState(Boolean(restored));
  const [pubCategory, setPubCategory] = useState(
    restored && PUBLIC_CATEGORY_KEYS.includes(restored.category) ? restored.category : PUBLIC_CATEGORY_KEYS[0] || "general",
  );
  const [guildCategory, setGuildCategory] = useState(restored?.target === "guild" ? restored.category : "");
  const [scheduled, setScheduled] = useState(Boolean(restored?.scheduled));
  const [publishAt, setPublishAt] = useState(restored?.publishAt ?? "");
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(() => (restored?.updatedAt ? clockOf(restored.updatedAt) : ""));
  const publishingRef = useRef(false);

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

  // 首次拿到会馆信息：默认发到会馆（与 Web 一致）；恢复草稿时以草稿里的选择为准
  useEffect(() => {
    if (!guildUsable) return;
    if (!targetTouched) setTarget("guild");
  }, [guildUsable, targetTouched]);

  // 草稿里选过会馆、但当前拿不到会馆标识（退馆 / 接口异常）：退回公共空间，避免「发布到」无选中项
  useEffect(() => {
    if (target !== "guild" || guildUsable || !profileQuery.isFetched) return;
    setTarget("public");
  }, [target, guildUsable, profileQuery.isFetched]);

  useEffect(() => {
    if (guildCategories.length === 0) return;
    setGuildCategory((current) => (current && guildCategories.includes(current) ? current : guildCategories[0]));
  }, [guildCategories]);

  // 有草稿 → 进入页面时提示一次（正文已随编辑器挂载注入）
  useEffect(() => {
    if (restored) showToast("已恢复草稿");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = title.trim().length > 0 || hasRichContent(content);
  // 会馆有自定义分类时用会馆分类；否则发到会馆时不带分类（对齐 Web 的隐藏规则）
  const categories = target === "guild" ? guildCategories : PUBLIC_CATEGORY_KEYS;
  const showCategory = categories.length > 0;
  const category = target === "guild" ? guildCategory : pubCategory;
  const categoryLabel = (key: string) => CATEGORY_LABELS[key] || key;

  // 自动保存：停手 700ms 落盘，底部状态条同步“自动保存中 → 已保存 hh:mm”
  useEffect(() => {
    if (!dirty) {
      dropDraft();
      setSaving(false);
      setSavedAt("");
      return;
    }
    setSaving(true);
    const timer = window.setTimeout(() => {
      const now = Date.now();
      writeDraft({ title, content, category, target, scheduled, publishAt, updatedAt: now });
      setSavedAt(clockOf(now));
      setSaving(false);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, title, content, category, target, scheduled, publishAt]);

  /* ------------------------------ 交互 ------------------------------ */

  const requestClose = useCallback(() => {
    if (busy) return;
    if (!dirty) {
      dropDraft();
      pop();
      return;
    }
    setConfirmDiscard(true);
  }, [busy, dirty, pop]);

  // 系统返回键同样走“确认丢弃”而不是直接退栈
  useEffect(() => registerBackHandler(() => {
    requestClose();
    return true;
  }), [requestClose]);

  const toggleScheduled = (on: boolean) => {
    setScheduled(on);
    setBounds(on ? computePublishBounds() : null);
  };

  const submit = async () => {
    if (publishingRef.current || busy) return;
    const trimmed = title.trim();
    if (!trimmed) return showToast("还差一个标题", "error");
    if (!hasRichContent(content)) return showToast("正文还是空的", "error");
    if (contentByteLength(content) > MAX_POST_CONTENT_BYTES) return showToast("正文过长（上限 256KB）", "error");
    if (target === "guild" && !guildUsable) return showToast("会馆信息缺失，请刷新后重试", "error");

    // 定时发布：校验范围（本地时间 → UTC ISO，与服务端 RFC3339 口径一致）
    let publishedAt: string | undefined;
    if (scheduled) {
      if (!publishAt) return showToast("请选择定时发布时间", "error");
      const live = computePublishBounds();
      setBounds(live);
      const value = publishAt < live.min ? live.min : publishAt;
      if (value !== publishAt) setPublishAt(value);
      const time = new Date(value).getTime();
      if (!Number.isFinite(time)) return showToast("定时发布时间无效", "error");
      if (time > Date.now() + SCHEDULE_MAX_AHEAD_MS) return showToast("定时发布时间不能超过 1 年", "error");
      publishedAt = new Date(time).toISOString();
    }

    publishingRef.current = true;
    setBusy(true);
    try {
      const res = await api.createPost({
        title: trimmed,
        content,
        category: category || undefined,
        guild_uuid: target === "guild" ? guild?.uuid : undefined,
        published_at: publishedAt,
      });
      dropDraft();
      showToast(scheduled ? "已设置定时发布" : "发布成功");
      // 离开编辑页并直接进入新帖（返回落在广场，不会回到已清空的编辑器）
      replace("post", { id: res.id });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "发布失败", "error");
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

  const segItems: { key: Target; label: React.ReactNode }[] = guildUsable && guild
    ? [
        { key: "public", label: "公共空间" },
        { key: "guild", label: `我的会馆（${guild.name}）` },
      ]
    : [{ key: "public", label: "公共空间" }];

  const status = busy ? "正在发布…" : saving ? "自动保存中…" : savedAt ? `已保存 ${savedAt}` : "草稿自动保存在本机";

  return (
    <Screen
      appbar={<ComposeAppBar onClose={requestClose} />}
      bodyClassName="cp-body"
      footer={
        <div className="m-actionbar cp-actionbar">
          <div className="cp-status" role="status" aria-live="polite">{status}</div>
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
            onChange={(event) => setTitle(event.target.value)}
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
                    onClick={() => (target === "guild" ? setGuildCategory(key) : setPubCategory(key))}
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
              onChange={setContent}
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
              onChange={(event) => setPublishAt(event.target.value)}
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

      <Confirm
        open={confirmDiscard}
        title="丢弃这篇草稿？"
        confirmText="丢弃"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          dropDraft();
          pop();
        }}
      >
        离开后本次编辑的内容不会保留。
      </Confirm>
    </Screen>
  );
}
