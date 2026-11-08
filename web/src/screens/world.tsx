import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { sse } from "../lib/native";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { Avatar, RichContent, TopBar } from "../components/ui";
import { timeAgo } from "../lib/format";
import "../styles/world-messages-page.css";

/**
 * 世界频道（tab 根页）。消息结构 / 输入条沿用论坛 Web 的 WorldChannelModal：
 * `.world-msg` 左右布局、`.world-msg-meta` 元信息、`.world-msg-bubble` + `.world-msg-content` 气泡，
 * 底部 `.world-input-bar`；首屏 50 条、向上翻页 200 条、SSE 增量去重 + 断线补拉、2 秒发言冷却。
 */

/** 首屏条数（对齐 Web WORLD_PAGE_SIZE） */
const PAGE_SIZE = 50;
/** 向上翻页条数（对齐 Web WORLD_HISTORY_SIZE） */
const HISTORY_SIZE = 200;
/** 后端单条上限（纯文本 2000 字） */
const MAX_CHARS = 2000;
/** 与服务端 2 秒限流对齐的本地冷却 */
const SEND_COOLDOWN_MS = 2000;

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
  guild_name?: string;
  is_leader?: boolean;
  is_admin?: boolean;
}

type SseListener = Awaited<ReturnType<typeof sse.addListener>>;

/** SSE 连接状态：实时 / 重连中（自动降级）/ 连接中 */
type LiveState = "connecting" | "live" | "polling";

const LIVE_LABEL: Record<LiveState, string> = {
  connecting: "连接中",
  live: "实时",
  polling: "轮询",
};

const LIVE_TITLE: Record<LiveState, string> = {
  connecting: "正在连接实时推送",
  live: "SSE 实时推送",
  polling: "实时连接中断，正在自动重连",
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

/** 单条消息：头像 + 元信息 + 气泡；本人 `.me` 靠右（与 Web WorldMessageItem 一致）。 */
function WorldMessageRow({
  item,
  mine,
  parentName,
  onOpenUser,
}: {
  item: WorldMessageItem;
  mine: boolean;
  parentName?: string;
  onOpenUser: (id: string) => void;
}) {
  const name = senderName(item) || "匿名";
  const uid = senderId(item);
  const avatar = senderAvatar(item);
  return (
    <article className={`world-msg${mine ? " me" : ""}`} data-message-id={item.id}>
      {uid ? (
        <button
          type="button"
          className="world-msg-avatar"
          aria-label={`${name} 的个人中心`}
          onClick={() => onOpenUser(uid)}
        >
          <Avatar src={avatar} name={name} size={36} />
        </button>
      ) : (
        <span className="world-msg-avatar">
          <Avatar src={avatar} name={name} size={36} />
        </span>
      )}
      <div className="world-msg-main">
        <div className="world-msg-meta">
          {uid ? (
            <button type="button" className="world-msg-name" onClick={() => onOpenUser(uid)}>
              {name}
            </button>
          ) : (
            <span className="world-msg-name">{name}</span>
          )}
          {item.is_admin ? (
            <span className="world-admin-chip" title="论坛管理团队">
              <i className="fa fa-shield" aria-hidden="true" />
              管理团队
            </span>
          ) : null}
          {item.guild_name ? (
            <span
              className="user-guild-chip"
              title={`会馆：${item.guild_name}`}
              style={{ background: "var(--color-bg-icon)", color: "var(--color-text-secondary)" }}
            >
              <i className="fa fa-home" aria-hidden="true" />
              {item.guild_name}
            </span>
          ) : null}
          {item.created_at ? (
            <time className="world-msg-time" dateTime={item.created_at}>
              {timeAgo(item.created_at)}
            </time>
          ) : null}
        </div>
        {parentName ? (
          <div className="world-msg-reply">
            <i className="fa fa-reply" aria-hidden="true" /> 回复 {parentName}
          </div>
        ) : null}
        <div className="world-msg-bubble">
          <div className="world-msg-content">
            <RichContent html={item.content} format={item.content_format} />
          </div>
        </div>
      </div>
    </article>
  );
}

/** 首屏骨架（对齐 Web WorldMessagesSkeleton）。 */
function WorldMessagesSkeleton() {
  return (
    <div className="world-skeleton-list" aria-label="正在加载世界频道消息">
      {[0, 1, 2].map((index) => (
        <div className="world-skeleton" key={index}>
          <span className="world-skeleton-avatar" />
          <span className="world-skeleton-lines">
            <i />
            <i />
          </span>
        </div>
      ))}
    </div>
  );
}

export function WorldScreen() {
  const user = useApp((state) => state.user);
  const showToast = useApp((state) => state.showToast);
  const { push } = useNav();

  const [messages, setMessages] = useState<WorldMessageItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingNew, setPendingNew] = useState(0);
  const [live, setLive] = useState<LiveState>("connecting");

  const messagesRef = useRef<WorldMessageItem[]>([]);
  const hasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const nearBottomRef = useRef(true);
  const sendingRef = useRef(false);
  const cooldownRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
        setLive("polling");
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
      setLive(payload?.state === "connected" ? "live" : "polling");
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
    const text = draft.trim();
    if (!text) return;
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
    try {
      await api.sendWorld(plainTextToHtml(text));
      setDraft("");
      cooldownRef.current = Date.now() + SEND_COOLDOWN_MS;
      await refreshAfter();
      requestAnimationFrame(() => scrollToBottom("smooth"));
    } catch (err) {
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

  const parentNames = useMemo(() => {
    const map = new Map<number, string>();
    messages.forEach((item) => map.set(messageId(item), senderName(item) || "匿名"));
    return map;
  }, [messages]);

  const myId = user?.id ? String(user.id) : "";
  const openUser = (id: string) => push("user", { id });

  return (
    <div className="world-page">
      <TopBar
        title="世界频道"
        actions={
          <span
            className={`world-live ${live === "live" ? "live" : live === "polling" ? "polling" : ""}`}
            title={LIVE_TITLE[live]}
          >
            <i className="fa fa-circle" aria-hidden="true" />
            {LIVE_LABEL[live]}
          </span>
        }
      />

      <div className="world-message-wrap">
        <div className="world-messages" ref={scrollRef} onScroll={handleScroll} aria-live="polite">
          {loading && messages.length === 0 ? (
            <WorldMessagesSkeleton />
          ) : error && messages.length === 0 ? (
            <div className="world-state world-state-error">
              <i className="fa fa-exclamation-circle" aria-hidden="true" />
              <span>{error}</span>
              <button type="button" className="world-state-btn" onClick={() => void loadInitial()}>
                重新加载
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="world-state">
              <i className="fa fa-comments-o" aria-hidden="true" />
              <span>世界频道还很安静，来说第一句话吧。</span>
            </div>
          ) : (
            <>
              {hasMore ? (
                <button type="button" className="world-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>
                  {loadingOlder ? (
                    <>
                      <i className="fa fa-spinner fa-spin" aria-hidden="true" /> 加载中…
                    </>
                  ) : (
                    <>
                      <i className="fa fa-arrow-up" aria-hidden="true" /> 加载更早消息
                    </>
                  )}
                </button>
              ) : (
                <div className="world-start">已加载全部消息</div>
              )}
              {messages.map((item) => (
                <WorldMessageRow
                  key={String(item.id)}
                  item={item}
                  mine={Boolean(myId) && senderId(item) === myId}
                  parentName={item.parent_id ? parentNames.get(Number(item.parent_id)) : undefined}
                  onOpenUser={openUser}
                />
              ))}
            </>
          )}
        </div>
        {pendingNew > 0 ? (
          <button type="button" className="world-new-messages" onClick={() => scrollToBottom("smooth")}>
            <i className="fa fa-arrow-down" aria-hidden="true" />
            {pendingNew} 条新消息
          </button>
        ) : null}
      </div>

      {error && messages.length > 0 ? (
        <div className="world-error-inline">
          <i className="fa fa-exclamation-circle" aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => void loadInitial()}>
            重试
          </button>
        </div>
      ) : null}

      <div className="world-input-bar">
        <div className="world-input-hint">
          <span className="world-input-channel">
            <i className="fa fa-globe" aria-hidden="true" /> 世界频道
          </span>
          <span>
            {MAX_CHARS} 字 · 2 秒内限发一条
            {!user ? (
              <>
                {" · "}
                <button type="button" onClick={() => push("auth")}>
                  登录
                </button>
                后发言
              </>
            ) : null}
          </span>
        </div>
        <div className="world-compose">
          <textarea
            value={draft}
            rows={2}
            maxLength={MAX_CHARS}
            aria-label="世界频道输入框"
            placeholder={user ? "在世界频道说点什么…" : "登录后即可参与世界频道…"}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="button"
            className="btn primary world-compose-send"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
          >
            {sending ? "发送中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
