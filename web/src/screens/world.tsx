import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { sse, vibrate } from "../lib/native";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { AppBar, Avatar, Cell, Empty, Screen, Sheet, Skeletons } from "../components/mobile";
import { Icon } from "../components/icons";
import { RichContent } from "../components/ui";
import { stripHtml, timeAgo } from "../lib/format";
import type { WorldParent } from "../lib/types";

/** TipTap 按需加载：只在切到富文本输入时加载 */
const RichEditor = React.lazy(() =>
  import("../components/RichEditor").then((mod) => ({ default: mod.RichEditor })),
);

/**
 * 世界频道（底部 Tab 一级页）。
 * 移动端重做：消息按「5 分钟内同作者」合并成组，组首才显示头像/昵称/时间；
 * 输入区固定在 TabBar 上方（Screen footer），textarea 38–96 自适应，仅超长时提示字数。
 * 业务侧保留：SSE 订阅/取消、首屏 50 条 + 向上翻页 200 条、乐观发送、去重、
 * 2 秒限流、贴底跟随滚动、后台回前台补拉。
 */

/** 首屏条数（对齐 Web WORLD_PAGE_SIZE） */
const PAGE_SIZE = 50;
/** 向上翻页条数（对齐 Web WORLD_HISTORY_SIZE） */
const HISTORY_SIZE = 200;
/** 后端单条上限（纯文本 2000 字） */
const MAX_CHARS = 2000;
/** 超过这个字数才显示计数，避免常驻噪音 */
const COUNTER_FROM = 1400;
/** 与服务端 2 秒限流对齐的本地冷却 */
const SEND_COOLDOWN_MS = 2000;
/** 同作者在该时间窗内的连续发言合并为一组 */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** 世界频道消息：后端字段为 sender_*，同时兼容旧契约的 user_* 命名。 */
interface WorldMessageItem {
  id: number | string;
  sender_id?: string;
  sender_name?: string;
  sender_avatar?: string;
  user_id?: string;
  user_name?: string;
  user_avatar?: string;
  content?: string;
  content_format?: string;
  created_at?: string;
  parent_id?: number | string | null;
  /** 被引用消息摘要（服务端下发；父消息已删除时为 null） */
  parent?: WorldParent | null;
  guild_name?: string;
  is_leader?: boolean;
  is_admin?: boolean;
}

/** 乐观发送的本地消息（尚未拿到服务端 id） */
interface PendingMessage {
  tempId: string;
  content: string;
  createdAt: string;
  /** 引用发送时的原消息发送者昵称（仅用于本地占位展示） */
  parentName?: string;
}

type SseListener = Awaited<ReturnType<typeof sse.addListener>>;

/** 弱提示用的连接状态：不暴露任何运维词汇 */
type LiveState = "connecting" | "live" | "offline";

const LIVE_TEXT: Record<LiveState, string> = {
  connecting: "连接中",
  live: "在线",
  offline: "已断开",
};

const LIVE_TITLE: Record<LiveState, string> = {
  connecting: "正在连接世界频道",
  live: "世界频道已连接",
  offline: "世界频道暂时断开，正在自动重试",
};

function messageId(item?: WorldMessageItem | null): number {
  const value = Number(item?.id);
  return Number.isFinite(value) ? value : 0;
}

function senderId(item: WorldMessageItem): string {
  return String(item.sender_id ?? item.user_id ?? "");
}

function senderName(item: WorldMessageItem): string {
  return String(item.sender_name ?? item.user_name ?? "");
}

function senderAvatar(item: WorldMessageItem): string {
  return String(item.sender_avatar ?? item.user_avatar ?? "");
}

/** 纯文本转义：聊天内容一律按文本处理，避免被当成 HTML 注入。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
}

/** 服务端按 id 排序（历史降序 / 增量升序），统一按 id 升序渲染。 */
function sortAscending(list: WorldMessageItem[]): WorldMessageItem[] {
  return [...list].sort((a, b) => messageId(a) - messageId(b));
}

/** SSE data 可能是 JSON 字符串，也可能是对象；兼容 {message}/{item}/裸消息三种包裹。 */
function parseWorldPayload(payload: any): WorldMessageItem | null {
  let data: any = payload?.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const candidate = data.message ?? data.item ?? data;
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.id === undefined || candidate.id === null) return null;
  if (typeof candidate.content !== "string") return null;
  return candidate as WorldMessageItem;
}

/** 引用展示信息：服务端 parent / 本地兜底 / 父消息已删除 */
interface ReplyParent {
  name: string;
  preview?: string;
  missing?: boolean;
}

/** 单条消息：组首才显示头像与昵称；本人靠右、主色气泡。 */
function WorldMessageRow({
  item,
  mine,
  head,
  parent,
  onOpenUser,
  onLongPress,
  onReply,
}: {
  item: WorldMessageItem;
  mine: boolean;
  head: boolean;
  parent?: ReplyParent | null;
  onOpenUser: (id: string) => void;
  onLongPress: (item: WorldMessageItem) => void;
  onReply: (item: WorldMessageItem) => void;
}) {
  const name = senderName(item) || "匿名";
  const uid = senderId(item);
  const avatar = senderAvatar(item);
  const pressTimer = useRef<number | null>(null);

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  useEffect(() => clearPress, []);

  /** 长按 480ms 弹出操作 Sheet（触屏）；桌面右键同样弹 */
  const startPress = () => {
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      void vibrate(12);
      onLongPress(item);
    }, 480);
  };

  // 可见的回复按钮：组首放在昵称行，续行单独一行，保证每条消息都能点
  const replyButton = (
    <button
      type="button"
      className="wd-replybtn"
      aria-label="回复这条消息"
      onClick={(event) => {
        event.stopPropagation();
        clearPress();
        onReply(item);
      }}
    >
      <Icon name="reply" size={14} />
    </button>
  );

  return (
    <div
      className={`wd-row ${mine ? "wd-row--mine" : "wd-row--them"} ${head ? "wd-row--head" : "wd-row--cont"}`}
      data-message-id={item.id}
      onTouchStart={startPress}
      onTouchMove={clearPress}
      onTouchEnd={clearPress}
      onTouchCancel={clearPress}
      onContextMenu={(event) => {
        event.preventDefault();
        clearPress();
        onLongPress(item);
      }}
    >
      {head ? (
        uid ? (
          <button type="button" className="wd-avatar" aria-label={`${name} 的个人主页`} onClick={() => onOpenUser(uid)}>
            <Avatar src={avatar} name={name} size={32} />
          </button>
        ) : (
          <span className="wd-avatar">
            <Avatar src={avatar} name={name} size={32} />
          </span>
        )
      ) : (
        <span className="wd-gutter" aria-hidden="true" />
      )}

      <div className="wd-col">
        {head ? (
          <div className="wd-meta">
            {!mine ? (
              uid ? (
                <button type="button" className="wd-name" onClick={() => onOpenUser(uid)}>
                  {name}
                </button>
              ) : (
                <span className="wd-name">{name}</span>
              )
            ) : null}
            {!mine && item.is_admin ? (
              <span className="wd-chip" title="论坛管理团队">
                <Icon name="shield" size={10} />
                管理
              </span>
            ) : null}
            {!mine && item.guild_name ? (
              <span className="wd-chip" title={`会馆：${item.guild_name}`}>
                <Icon name="home" size={10} />
                {item.guild_name}
              </span>
            ) : null}
            {item.created_at ? (
              <time className="wd-time" dateTime={item.created_at}>
                {timeAgo(item.created_at)}
              </time>
            ) : null}
            {replyButton}
          </div>
        ) : null}

        {parent ? (
          parent.missing ? (
            <div className="wd-reply wd-reply--missing">
              <Icon name="alert" size={10} />
              原消息已删除
            </div>
          ) : (
            <div className="wd-reply">
              回复 <b>{parent.name}</b>
              {parent.preview ? `：${parent.preview}` : ""}
            </div>
          )
        ) : null}

        <div className={`wd-bubble${mine ? " wd-bubble--mine" : ""}`}>
          <div className="wd-txt">
            <RichContent html={item.content} format={item.content_format} />
          </div>
        </div>

        {head ? null : <div className="wd-tools">{replyButton}</div>}
      </div>
    </div>
  );
}

export function WorldScreen() {
  const user = useApp((state) => state.user);
  const showToast = useApp((state) => state.showToast);
  const { push } = useNav();

  const [messages, setMessages] = useState<WorldMessageItem[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  /** 富文本模式：正文以 HTML 保存，发送时直接作为 content_html */
  const [richOpen, setRichOpen] = useState(false);
  const [richDoc, setRichDoc] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingNew, setPendingNew] = useState(0);
  const [live, setLive] = useState<LiveState>("connecting");
  /** 引用回复目标（输入框上方的引用条） */
  const [replyTo, setReplyTo] = useState<{ id: number | string; name: string; preview: string } | null>(null);
  /** 长按操作 Sheet 的目标消息 */
  const [actionTarget, setActionTarget] = useState<WorldMessageItem | null>(null);

  const messagesRef = useRef<WorldMessageItem[]>([]);
  const hasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const nearBottomRef = useRef(true);
  const sendingRef = useRef(false);
  const cooldownRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const myId = user?.id ? String(user.id) : "";

  const setList = useCallback((next: WorldMessageItem[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const node = scrollRef.current;
    if (!node) return;
    try {
      node.scrollTo({ top: node.scrollHeight, behavior });
    } catch {
      node.scrollTop = node.scrollHeight;
    }
    nearBottomRef.current = true;
    setPendingNew(0);
  }, []);

  /** 追加消息：按 id 去重；贴底时自动滚动，否则累计「N 条新消息」提示。 */
  const appendIncoming = useCallback(
    (incoming: WorldMessageItem[]) => {
      if (incoming.length === 0) return;
      const known = new Set(messagesRef.current.map((item) => String(item.id)));
      const fresh = incoming.filter((item) => !known.has(String(item.id)));
      if (fresh.length === 0) return;
      setList(sortAscending([...messagesRef.current, ...fresh]));
      if (nearBottomRef.current) {
        setPendingNew(0);
        requestAnimationFrame(() => scrollToBottom("auto"));
      } else {
        setPendingNew((count) => count + fresh.length);
      }
    },
    [scrollToBottom, setList],
  );

  /** 首屏 50 条（最新一页，服务端降序 → 翻转成升序）。 */
  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res: any = await api.worldMessages({ limit: PAGE_SIZE });
      const page: WorldMessageItem[] = Array.isArray(res?.items) ? res.items : [];
      setList(sortAscending(page));
      const more = Boolean(res?.has_more) && Number(res?.next_before_id) > 0;
      hasMoreRef.current = more;
      setHasMore(more);
      requestAnimationFrame(() => scrollToBottom("auto"));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "世界频道加载失败");
    } finally {
      setLoading(false);
    }
  }, [scrollToBottom, setList]);

  /** 向上翻页 200 条，保持当前滚动位置不跳动。 */
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreRef.current) return;
    const beforeId = messageId(messagesRef.current[0]);
    if (!beforeId) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const node = scrollRef.current;
    const previousHeight = node?.scrollHeight ?? 0;
    const previousTop = node?.scrollTop ?? 0;
    try {
      const res: any = await api.worldMessages({ before_id: beforeId, limit: HISTORY_SIZE });
      const older: WorldMessageItem[] = Array.isArray(res?.items) ? res.items : [];
      if (older.length > 0) {
        const known = new Set(messagesRef.current.map((item) => String(item.id)));
        setList(sortAscending([...older.filter((item) => !known.has(String(item.id))), ...messagesRef.current]));
      }
      const more = Boolean(res?.has_more) && Number(res?.next_before_id) > 0;
      hasMoreRef.current = more;
      setHasMore(more);
      requestAnimationFrame(() => {
        const scrubber = scrollRef.current;
        if (scrubber) scrubber.scrollTop = previousTop + (scrubber.scrollHeight - previousHeight);
      });
    } catch {
      showToast("加载更早消息失败", "error");
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [setList, showToast]);

  /** 用 after_id 补拉缺口（发送后 / 回到前台）。 */
  const refreshAfter = useCallback(async () => {
    const afterId = messageId(messagesRef.current[messagesRef.current.length - 1]);
    if (!afterId) {
      await loadInitial();
      return;
    }
    try {
      const res: any = await api.worldMessages({ after_id: afterId, limit: 500 });
      appendIncoming(Array.isArray(res?.items) ? res.items : []);
    } catch {
      /* 网络抖动：保持已加载内容，等下一条 SSE 或下次刷新 */
    }
  }, [appendIncoming, loadInitial]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // SSE：订阅 world 频道；卸载时移除监听并断开连接，避免重复连接。
  useEffect(() => {
    let active = true;
    let streamHandle: SseListener | null = null;
    let stateHandle: SseListener | null = null;
    const onEvent = (payload: any) => {
      if (!active) return;
      if (payload?.channel && payload.channel !== "world") return;
      if (payload?.state) {
        setLive("offline");
        return;
      }
      const type = String(payload?.event || "message");
      if (type === "hello") {
        setLive("live");
        return;
      }
      if (type === "heartbeat") return;
      if (type !== "message") return;
      const incoming = parseWorldPayload(payload);
      if (!incoming) return;
      setLive("live");
      appendIncoming([incoming]);
    };
    const onState = (payload: any) => {
      if (!active) return;
      if (payload?.channel && payload.channel !== "world") return;
      setLive(payload?.state === "connected" ? "live" : "offline");
    };
    void sse
      .addListener("sse", onEvent)
      .then((listener) => {
        if (active) streamHandle = listener;
        else void listener.remove();
      })
      .catch(() => undefined);
    void sse
      .addListener("sseState", onState)
      .then((listener) => {
        if (active) stateHandle = listener;
        else void listener.remove();
      })
      .catch(() => undefined);
    void sse.start({ channel: "world" }).catch(() => undefined);
    return () => {
      active = false;
      void streamHandle?.remove();
      void stateHandle?.remove();
      streamHandle = null;
      stateHandle = null;
      void sse.stop({ channel: "world" }).catch(() => undefined);
    };
  }, [appendIncoming]);

  // 回到前台补拉一次，避免后台期间被系统节流造成缺口。
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshAfter();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshAfter]);

  // 输入框自适应高度：38（一行）到 96（约四行）。
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    const next = Math.min(96, Math.max(38, node.scrollHeight));
    node.style.height = `${next}px`;
  }, [draft]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 96;
    nearBottomRef.current = nearBottom;
    if (nearBottom) setPendingNew(0);
    if (node.scrollTop <= 24 && hasMoreRef.current) void loadOlder();
  };

  const send = async () => {
    if (sendingRef.current) return;
    const richPlain = stripHtml(richDoc).trim();
    const text = richOpen ? richPlain : draft.trim();
    if (!text) return;
    if (text.length > MAX_CHARS) {
      showToast(`内容超过 ${MAX_CHARS} 字上限`, "error");
      return;
    }
    if (!user) {
      showToast("请先登录后参与世界频道", "error");
      return;
    }
    const now = Date.now();
    if (now < cooldownRef.current) {
      const seconds = Math.max(1, Math.ceil((cooldownRef.current - now) / 1000));
      showToast(`发言太快，请 ${seconds} 秒后再试`, "error");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    const tempId = `tmp-${now}`;
    // 富文本直接发 HTML（已由编辑器产出，提交前再做一次白名单清洗在渲染侧完成）
    const html = richOpen ? richDoc : plainTextToHtml(text);
    const parentId = replyTo && Number(replyTo.id) > 0 ? Number(replyTo.id) : undefined;
    // 乐观发送：先以本地消息占位，失败再回滚。
    setPending((list) => [
      ...list,
      { tempId, content: html, createdAt: new Date().toISOString(), parentName: replyTo?.name },
    ]);
    if (richOpen) setRichDoc("");
    else setDraft("");
    nearBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom("smooth"));
    try {
      await api.sendWorld(html, parentId);
      cooldownRef.current = Date.now() + SEND_COOLDOWN_MS;
      // 引用只在发送成功后清空，失败时保留以便重试
      setReplyTo(null);
      await refreshAfter();
      setPending((list) => list.filter((item) => item.tempId !== tempId));
      requestAnimationFrame(() => scrollToBottom("smooth"));
    } catch (err) {
      setPending((list) => list.filter((item) => item.tempId !== tempId));
      if (richOpen) setRichDoc((current) => (current ? current : html));
      else setDraft((current) => (current ? current : text));
      if (err instanceof ApiError && err.status === 429) {
        cooldownRef.current = Date.now() + SEND_COOLDOWN_MS;
        showToast("发言太快，稍后再试", "error");
      } else {
        showToast(err instanceof Error && err.message ? err.message : "发送失败", "error");
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  /** 本地已加载消息的摘要：服务端未下发 parent 时（旧数据）用它兑底 */
  const parentMap = useMemo(() => {
    const map = new Map<number, { name: string; preview: string }>();
    messages.forEach((item) =>
      map.set(messageId(item), {
        name: senderName(item) || "匿名",
        preview: stripHtml(item.content || "").slice(0, 60),
      }),
    );
    return map;
  }, [messages]);

  /** 5 分钟内同一作者合并为一组，组首才渲染头像/昵称/时间。 */
  const rows = useMemo(() => {
    return messages.map((item, index) => {
      const previous = index > 0 ? messages[index - 1] : null;
      const stamp = Date.parse(item.created_at || "") || 0;
      const previousStamp = Date.parse(previous?.created_at || "") || 0;
      const sameAuthor =
        Boolean(previous) &&
        senderId(previous as WorldMessageItem) === senderId(item) &&
        (senderName(previous as WorldMessageItem) || "匿名") === (senderName(item) || "匿名");
      const withinWindow = stamp > 0 && previousStamp > 0 && Math.abs(stamp - previousStamp) <= GROUP_WINDOW_MS;
      const head = !previous || !sameAuthor || !withinWindow || Boolean(item.parent_id);
      const parentKey = item.parent_id ? Number(item.parent_id) : 0;
      const local = parentKey > 0 ? parentMap.get(parentKey) : undefined;
      // 优先服务端 parent（含快照）；缺失时用本地列表兑底；都没有则视为已删除
      const parent: ReplyParent | null = item.parent
        ? {
            name: item.parent.sender_name || "匿名",
            preview: stripHtml(item.parent.content || "").slice(0, 60),
          }
        : local
          ? { name: local.name, preview: local.preview }
          : parentKey > 0
            ? { name: "", missing: true }
            : null;
      return {
        item,
        mine: Boolean(myId) && senderId(item) === myId,
        head,
        parent,
      };
    });
  }, [messages, myId, parentMap]);

  const openUser = (id: string) => push("user", { id });

  /** 引用回复：记下目标消息，聚焦输入框 */
  const startReply = (item: WorldMessageItem) => {
    setActionTarget(null);
    setReplyTo({
      id: item.id,
      name: senderName(item) || "匿名",
      preview: stripHtml(item.content || "").replace(/\s+/g, " ").trim().slice(0, 60),
    });
    if (!richOpen) requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** 长按操作：复制正文纯文本 */
  const copyMessage = async (item: WorldMessageItem) => {
    setActionTarget(null);
    const text = stripHtml(item.content || "").trim();
    if (!text) {
      showToast("这条消息没有可复制的文字", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制");
    } catch {
      showToast("复制失败，请长按选择文字", "error");
    }
  };
  const richLength = stripHtml(richDoc).trim().length;
  const counterVisible = (richOpen ? richLength : draft.length) > COUNTER_FROM;

  return (
    <Screen
      className="wd-screen"
      bodyClassName="wd-body"
      appbar={
        <AppBar
          title="世界频道"
          actions={
            <span className={`wd-live wd-live--${live}`} title={LIVE_TITLE[live]} role="status">
              <i className="wd-live-dot" aria-hidden="true" />
              <span className="wd-live-txt">{LIVE_TEXT[live]}</span>
            </span>
          }
        />
      }
      footer={
        <div className="wd-composer">
          {counterVisible ? (
            <div className="wd-counter" aria-live="polite">
              {richOpen ? richLength : draft.length} / {MAX_CHARS}
            </div>
          ) : null}
          {richOpen ? (
            <div className="wd-rich">
              <Suspense
                fallback={
                  <div className="wd-rich-loading">
                    <span className="m-spinner" />
                    <span>编辑器加载中…</span>
                  </div>
                }
              >
                <RichEditor
                  value={richDoc}
                  onChange={setRichDoc}
                  placeholder="支持加粗、链接与图片…"
                  scene="world_message"
                  minHeight={64}
                  toolbar="compact"
                />
              </Suspense>
            </div>
          ) : null}
          {replyTo ? (
            <div className="wd-quotebar">
              <Icon name="reply" size={13} />
              <span className="wd-quotebar-body">
                <span className="wd-quotebar-name">回复 {replyTo.name}</span>
                {replyTo.preview ? <span className="wd-quotebar-preview">{replyTo.preview}</span> : null}
              </span>
              <button type="button" className="wd-quotebar-x" aria-label="取消引用" onClick={() => setReplyTo(null)}>
                <Icon name="close" size={15} />
              </button>
            </div>
          ) : null}
          <div className="wd-inputrow">
            <button
              type="button"
              className={`wd-rich-toggle${richOpen ? " on" : ""}`}
              aria-label={richOpen ? "切换为纯文本" : "切换为富文本"}
              aria-pressed={richOpen}
              onClick={() => setRichOpen((open) => !open)}
            >
              <Icon name="edit" size={18} />
            </button>
            {richOpen ? (
              <>
                <span className="wd-rich-hint">富文本模式</span>
                <button
                  type="button"
                  className="wd-send"
                  aria-label="发送"
                  disabled={sending || richLength === 0}
                  onClick={() => void send()}
                >
                  <Icon name="send" size={19} />
                </button>
              </>
            ) : (
              <>
                <textarea
                  ref={inputRef}
                  className="wd-input"
                  value={draft}
                  rows={1}
                  maxLength={MAX_CHARS}
                  aria-label="世界频道输入框"
                  placeholder={user ? "说点什么…" : "登录后即可参与世界频道"}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="wd-send"
                  aria-label="发送"
                  disabled={sending || !draft.trim()}
                  onClick={() => void send()}
                >
                  <Icon name="send" size={19} />
                </button>
              </>
            )}
          </div>
        </div>
      }
    >
      {error && messages.length > 0 ? (
        <div className="wd-errorbar" role="status">
          <span className="wd-errorbar-txt">{error}</span>
          <button type="button" onClick={() => void loadInitial()}>
            重试
          </button>
        </div>
      ) : null}

      <div className="wd-threadwrap">
        <div
          className={`wd-thread${messages.length === 0 ? " wd-thread--top" : ""}`}
          ref={scrollRef}
          onScroll={handleScroll}
          aria-live="polite"
        >
          {loading && messages.length === 0 ? (
            <Skeletons count={4} />
          ) : error && messages.length === 0 ? (
            <Empty
              icon="info"
              title="世界频道加载失败"
              hint={error}
              action={
                <button type="button" className="m-btn m-btn--primary m-btn--sm" onClick={() => void loadInitial()}>
                  重新加载
                </button>
              }
            />
          ) : messages.length === 0 ? (
            <Empty icon="globe" title="世界频道还很安静" hint="来说第一句话吧" />
          ) : (
            <>
              {hasMore ? (
                <button type="button" className="wd-older" disabled={loadingOlder} onClick={() => void loadOlder()}>
                  {loadingOlder ? "加载中…" : "加载更早消息"}
                </button>
              ) : (
                <div className="wd-end">— 已加载全部 —</div>
              )}

              {rows.map((row) => (
                <WorldMessageRow
                  key={String(row.item.id)}
                  item={row.item}
                  mine={row.mine}
                  head={row.head}
                  parent={row.parent}
                  onOpenUser={openUser}
                  onLongPress={setActionTarget}
                  onReply={startReply}
                />
              ))}

              {pending.map((item) => (
                <div key={item.tempId} className="wd-row wd-row--mine wd-row--head wd-row--pending">
                  <span className="wd-avatar">
                    <Avatar src={user?.avatar} name={user?.name} size={32} />
                  </span>
                  <div className="wd-col">
                    <div className="wd-meta">
                      <span className="wd-time">发送中…</span>
                    </div>
                    {item.parentName ? (
                      <div className="wd-reply">
                        回复 <b>{item.parentName}</b>
                      </div>
                    ) : null}
                    <div className="wd-bubble wd-bubble--mine">
                      <div className="wd-txt">
                        <RichContent html={item.content} format="html" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {pendingNew > 0 ? (
          <button type="button" className="wd-jump" onClick={() => scrollToBottom("smooth")}>
            <Icon name="down" size={13} />
            {pendingNew} 条新消息
          </button>
        ) : null}
      </div>

      <Sheet open={Boolean(actionTarget)} title="消息操作" onClose={() => setActionTarget(null)}>
        <div className="m-list">
          <Cell
            icon="reply"
            label="回复"
            chevron={false}
            onClick={() => {
              if (actionTarget) startReply(actionTarget);
            }}
          />
          <Cell
            icon="copy"
            label="复制文字"
            chevron={false}
            onClick={() => {
              if (actionTarget) void copyMessage(actionTarget);
            }}
          />
        </div>
      </Sheet>
    </Screen>
  );
}
