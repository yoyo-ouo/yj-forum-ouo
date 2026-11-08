import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { openExternal, requestApi, sse } from "../lib/native";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { Avatar, RichContent } from "../components/ui";
import { timeAgo } from "../lib/format";
import "../styles/world-messages-page.css";

/**
 * 消息中心。结构沿用论坛 Web 的 MessageCenter：
 * `.msg-page` / `.msg-shell` / `.msg-sidebar`（标题 + 连接状态 + 横向 `.msg-type-list`）/ `.msg-detail`；
 * 管理团队会话为单视图（`.msg-shell.is-chat-view`，隐藏类型栏 + 顶部返回）。
 * 数据侧保留未读上报、游标分页、管理团队发送与 SSE 刷新（断线时 15 秒轮询兜底）。
 */

type MessageTab = "likes" | "comments" | "system" | "chat";
type MessageCategory = "likes" | "comments" | "system";

interface TabMeta {
  key: MessageTab;
  label: string;
  icon: string;
  title: string;
  subtitle: string;
  empty: string;
}

const TABS: TabMeta[] = [
  {
    key: "likes",
    label: "赞",
    icon: "fa-heart",
    title: "收到的赞",
    subtitle: "帖子与评论收到的赞",
    empty: "还没有收到赞",
  },
  {
    key: "comments",
    label: "评论",
    icon: "fa-comment",
    title: "评论与回复",
    subtitle: "帖子下的新评论与对你的回复",
    empty: "还没有评论消息",
  },
  {
    key: "system",
    label: "系统",
    icon: "fa-bullhorn",
    title: "系统通知",
    subtitle: "站内公告与系统提醒",
    empty: "暂无系统通知",
  },
  {
    key: "chat",
    label: "管理团队",
    icon: "fa-comments",
    title: "管理团队",
    subtitle: "与论坛管理团队的私密会话",
    empty: "还没有消息，给管理团队留言吧",
  },
];

type SseListener = Awaited<ReturnType<typeof sse.addListener>>;
type ConnState = "connecting" | "open" | "degraded";

const CONN_LABEL: Record<ConnState, string> = {
  open: "实时连接已建立",
  connecting: "正在连接…",
  degraded: "轮询模式（15 秒）",
};

/** 服务端 2 秒/用户限流 */
const SEND_COOLDOWN_MS = 2000;
/** 断线降级轮询间隔（对齐 Web useMessageStream） */
const POLL_INTERVAL_MS = 15_000;

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

function likeAction(targetType?: string): string {
  if (targetType === "post") return "赞了你的帖子";
  if (targetType === "character") return "赞了你的设定";
  return "赞了你的评论";
}

function unreadOf(type: MessageTab, unread: { likes: number; comments: number; system: number; chat: number }): number {
  if (type === "chat") return unread.chat;
  return unread[type];
}

function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** 列表骨架（对齐 Web MessageList 的 .msg-skeleton-*）。 */
function MessageSkeleton() {
  return (
    <div className="msg-skeleton-list" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <div className="msg-skeleton-row" key={index}>
          <span className="msg-skeleton-avatar" />
          <span className="msg-skeleton-main">
            <span className="msg-skeleton-line w60" />
            <span className="msg-skeleton-line w90" />
            <span className="msg-skeleton-line w40" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** 会话骨架（对齐 Web ChatPanel 的 .msg-chat-skeleton）。 */
function ChatSkeleton() {
  return (
    <div className="msg-chat-skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div className={`msg-chat-skel-row ${index % 2 === 0 ? "them" : "me"}`} key={index}>
          <span className="msg-skeleton-avatar" />
          <span className="msg-chat-skel-bubble" />
        </div>
      ))}
    </div>
  );
}

/** 空态 / 错误态（对齐 Web MessageList 的 .msg-state）。 */
function StateBlock({
  icon,
  text,
  hint,
  action,
  onAction,
}: {
  icon: string;
  text: string;
  hint?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="msg-state">
      <i className={`fa ${icon} msg-state-icon`} aria-hidden="true" />
      <div className="msg-state-text">{text}</div>
      {hint ? <div className="msg-state-hint">{hint}</div> : null}
      {action && onAction ? (
        <button type="button" className="msg-retry-btn" onClick={onAction}>
          <i className="fa fa-refresh" aria-hidden="true" /> {action}
        </button>
      ) : null}
    </div>
  );
}

export function MessagesScreen() {
  const user = useApp((state) => state.user);
  const showToast = useApp((state) => state.showToast);
  const unread = useApp((state) => state.unread);
  const setUnread = useApp((state) => state.setUnread);
  const { push } = useNav();

  const [tab, setTab] = useState<MessageTab>("likes");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [conn, setConn] = useState<ConnState>("connecting");
  /** 进入 tab 时的未读预算：前 N 条显示未读点（上报已读后徽标清零，点仍保留）。 */
  const [dots, setDots] = useState<Record<MessageTab, number>>({ likes: 0, comments: 0, system: 0, chat: 0 });

  const cursorRef = useRef<string | undefined>(undefined);
  const requestIdRef = useRef(0);
  /** 最近一次浏览的列表 tab：会话返回到这里（Web 是「全部」，本页没有全部） */
  const listTabRef = useRef<MessageTab>("likes");
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const sendingRef = useRef(false);
  const lastSentRef = useRef(0);

  const refreshUnread = useCallback(async () => {
    try {
      const summary = await api.messagesSummary();
      setUnread({
        likes: summary?.likes ?? 0,
        comments: summary?.comments ?? 0,
        system: summary?.system ?? 0,
        chat: summary?.chat ?? 0,
      });
    } catch {
      /* 未读数刷新失败不打扰用户 */
    }
  }, [setUnread]);

  const markChatRead = useCallback(
    async (lastMessageId: number) => {
      if (!lastMessageId) return;
      try {
        await requestApi({ method: "POST", path: "/messages/chat/read", body: { last_message_id: lastMessageId } });
        await refreshUnread();
      } catch {
        /* 已读上报失败不阻塞列表 */
      }
    },
    [refreshUnread],
  );

  /** reset=true 拉首屏；silent=true 不显示整页 Loading（SSE 刷新、发消息后刷新）。 */
  const load = useCallback(
    async (reset: boolean, silent = false) => {
      if (!user?.id) return;
      const requestId = ++requestIdRef.current;
      if (reset) {
        if (!silent) setLoading(true);
        setError("");
      } else {
        setLoadingMore(true);
      }
      // 聊天 silent 刷新只做增量合并，保留已加载的更早分页与游标。
      const mergeChat = reset && silent && tab === "chat";
      try {
        const cursor = reset ? undefined : cursorRef.current;
        const res: any =
          tab === "chat" ? await api.messagesChat(cursor) : await api.messagesCategory(tab, cursor);
        if (requestId !== requestIdRef.current) return;
        const incoming: any[] = Array.isArray(res?.items) ? res.items : [];
        if (mergeChat) {
          setItems((current) => {
            const map = new Map<number, any>();
            current.forEach((item) => map.set(Number(item?.id) || 0, item));
            incoming.forEach((item) => map.set(Number(item?.id) || 0, item));
            return [...map.values()].sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0));
          });
        } else {
          setItems((current) => (reset ? incoming : [...current, ...incoming]));
          setHasMore(Boolean(res?.has_more));
          cursorRef.current = res?.next_cursor ? String(res.next_cursor) : undefined;
        }
        if (tab === "chat") {
          const lastId = incoming.reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0);
          stickRef.current = true;
          void markChatRead(lastId);
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error && err.message ? err.message : "消息加载失败");
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [markChatRead, tab, user?.id],
  );

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // 切换 tab：重置游标并拉取首屏。
  useEffect(() => {
    if (!user?.id) return;
    cursorRef.current = undefined;
    setItems([]);
    setHasMore(false);
    setError("");
    setDraft("");
    void load(true);
  }, [load, user?.id]);

  // 切换 tab：记录返回目标（管理团队会话顶部「返回」用）。
  useEffect(() => {
    if (tab !== "chat") listTabRef.current = tab;
  }, [tab]);

  // 切换 tab：记录未读预算，随后上报已读并刷新全局未读数。
  useEffect(() => {
    if (!user?.id || tab === "chat") return;
    const category: MessageCategory = tab;
    const snapshot = useApp.getState().unread[category] || 0;
    setDots((current) => (current[category] > 0 ? current : { ...current, [category]: snapshot }));
    let cancelled = false;
    void (async () => {
      try {
        await api.markRead(category, new Date().toISOString());
        if (cancelled) return;
        await refreshUnread();
      } catch {
        /* 已读上报失败不阻塞列表 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUnread, tab, user?.id]);

  // SSE：订阅 /messages/stream，收到新通知 / 未读事件时刷新列表与徽标。
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    let streamHandle: SseListener | null = null;
    let stateHandle: SseListener | null = null;
    const onEvent = (payload: any) => {
      if (!active) return;
      if (payload?.channel && payload.channel !== "messages") return;
      if (payload?.state) {
        setConn("degraded");
        return;
      }
      const type = String(payload?.event || "message");
      if (type === "heartbeat") return;
      if (type === "hello") {
        setConn("open");
        return;
      }
      let data: any = payload?.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          data = null;
        }
      }
      if (type === "unread" && data) {
        setConn("open");
        setUnread({
          likes: Number(data.likes) || 0,
          comments: Number(data.comments) || 0,
          system: Number(data.system) || 0,
          chat: Number(data.chat) || 0,
        });
        return;
      }
      void loadRef.current(true, true);
      void refreshUnread();
      setConn("open");
    };
    const onState = (payload: any) => {
      if (!active) return;
      if (payload?.channel && payload.channel !== "messages") return;
      setConn(payload?.state === "connected" ? "open" : "degraded");
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
    void sse.start({ channel: "messages" }).catch(() => undefined);
    return () => {
      active = false;
      void streamHandle?.remove();
      void stateHandle?.remove();
      streamHandle = null;
      stateHandle = null;
      void sse.stop({ channel: "messages" }).catch(() => undefined);
    };
  }, [refreshUnread, setUnread, user?.id]);

  // 实时连接断开时降级为 15 秒轮询（SSE 恢复后自动停止）。
  useEffect(() => {
    if (!user?.id || conn !== "degraded") return;
    const timer = window.setInterval(() => {
      void loadRef.current(true, true);
      void refreshUnread();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [conn, refreshUnread, user?.id]);

  // 回到前台刷新一次（后台期间 WebView 可能被节流）。
  useEffect(() => {
    if (!user?.id) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void loadRef.current(true, true);
      void refreshUnread();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshUnread, user?.id]);

  // 聊天窗口：贴底时才跟随新消息滚动（加载更早消息不跳动）。
  useEffect(() => {
    if (tab !== "chat" || !stickRef.current) return;
    const node = chatListRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, [tab, items]);

  const handleChatScroll = () => {
    const node = chatListRef.current;
    if (!node) return;
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
  };

  const loadOlderChat = async () => {
    const node = chatListRef.current;
    const previousHeight = node?.scrollHeight ?? 0;
    const previousTop = node?.scrollTop ?? 0;
    stickRef.current = false;
    await load(false);
    requestAnimationFrame(() => {
      const scrubber = chatListRef.current;
      if (scrubber) scrubber.scrollTop = previousTop + (scrubber.scrollHeight - previousHeight);
      stickRef.current = true;
    });
  };

  const openMessageLink = (link?: string | null) => {
    if (!link) return;
    const match = link.match(/^\/([a-z-]+)\/([^/?#]+)/i);
    if (match) {
      const kind = match[1].toLowerCase();
      const id = match[2];
      if (kind === "post") {
        push("post", { id });
        return;
      }
      if (kind === "article") {
        push("article", { id });
        return;
      }
      if (kind === "user" || kind === "users") {
        push("user", { id });
        return;
      }
      if (kind === "character") {
        push("character-detail", { id });
        return;
      }
    }
    void openExternal(link);
  };

  const sendChat = async () => {
    if (sendingRef.current) return;
    const text = draft.trim();
    if (!text) return;
    const now = Date.now();
    if (now - lastSentRef.current < SEND_COOLDOWN_MS) {
      const seconds = Math.max(1, Math.ceil((SEND_COOLDOWN_MS - (now - lastSentRef.current)) / 1000));
      showToast(`发送太快，请 ${seconds} 秒后再试`, "error");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    const html = plainTextToHtml(text);
    try {
      const res: any = await api.sendChat(html);
      setDraft("");
      lastSentRef.current = Date.now();
      stickRef.current = true;
      if (res?.id) {
        void markChatRead(Number(res.id));
        setItems((current) => [
          ...current,
          {
            id: res.id,
            sender_type: "user",
            sender_name: user?.name || "我",
            sender_avatar: user?.avatar || "",
            content_html: html,
            content_format: "html",
            created_at: new Date().toISOString(),
          },
        ]);
      }
      await load(true, true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        lastSentRef.current = Date.now();
        showToast("发送太快，稍后再试", "error");
      } else {
        showToast(err instanceof Error && err.message ? err.message : "发送失败", "error");
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (!user) {
    return (
      <div className="msg-page app-msg-page">
        <div className="msg-gate">
          <i className="fa fa-envelope-o msg-gate-icon" aria-hidden="true" />
          <h1>消息中心</h1>
          <p>登录后查看点赞、评论与管理团队消息</p>
          <button type="button" className="msg-gate-btn" onClick={() => push("auth")}>
            <i className="fa fa-sign-in" aria-hidden="true" /> 去登录
          </button>
        </div>
      </div>
    );
  }

  const meta = TABS.find((entry) => entry.key === tab) || TABS[0];
  const dotBudget = tab === "chat" ? 0 : dots[tab] || 0;
  const chatMessages = [...items].sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0));

  const unreadDot = (show: boolean) => (show ? <span className="msg-item-dot" aria-label="未读" /> : null);

  const renderLike = (item: any, index: number) => {
    const actorName = item?.actor?.name || "有人";
    const action = likeAction(item?.target_type);
    const title = item?.post_title || item?.target_title || "";
    const excerpt = item?.comment_excerpt || "";
    const isCharacter = item?.target_type === "character" && item?.target_id;
    const postId = item?.post_id;
    const clickable = Boolean(isCharacter || postId);
    const open = () => {
      if (isCharacter) {
        push("character-detail", { id: String(item.target_id) });
        return;
      }
      if (postId) push("post", { id: String(postId) });
    };
    return (
      <button
        type="button"
        key={`like-${item?.id ?? index}`}
        className={`msg-item${index < dotBudget ? " is-unread" : ""}${clickable ? " is-link" : ""}`}
        aria-label={`${actorName} ${action}${title ? `：${title}` : ""}`}
        disabled={!clickable}
        onClick={open}
      >
        <span className="msg-item-avatar">
          <Avatar src={item?.actor?.avatar} name={actorName} size={40} />
        </span>
        <span className="msg-item-main">
          <span className="msg-item-head">
            <span className="msg-item-name">{actorName}</span>
            <span className="msg-item-action">{action}</span>
            <span className="msg-item-time">{timeAgo(item?.created_at)}</span>
            {unreadDot(index < dotBudget)}
          </span>
          {title ? <span className="msg-item-title">{title}</span> : null}
          {excerpt ? <span className="msg-item-excerpt">{excerpt}</span> : null}
        </span>
        {clickable ? <i className="fa fa-angle-right msg-item-arrow" aria-hidden="true" /> : null}
      </button>
    );
  };

  const renderComment = (item: any, index: number) => {
    const actorName = item?.actor?.name || "有人";
    const action = item?.parent_id ? "回复了你的评论" : "评论了你的帖子";
    const title = item?.post_title || "";
    const excerpt = item?.excerpt || "";
    const postId = item?.post_id;
    return (
      <button
        type="button"
        key={`comment-${item?.id ?? index}`}
        className={`msg-item${index < dotBudget ? " is-unread" : ""}${postId ? " is-link" : ""}`}
        aria-label={`${actorName} ${action}${title ? `：${title}` : ""}`}
        disabled={!postId}
        onClick={() => {
          if (postId) push("post", { id: String(postId) });
        }}
      >
        <span className="msg-item-avatar">
          <Avatar src={item?.actor?.avatar} name={actorName} size={40} />
        </span>
        <span className="msg-item-main">
          <span className="msg-item-head">
            <span className="msg-item-name">{actorName}</span>
            <span className="msg-item-action">{action}</span>
            <span className="msg-item-time">{timeAgo(item?.created_at)}</span>
            {unreadDot(index < dotBudget)}
          </span>
          {title ? <span className="msg-item-title">{title}</span> : null}
          {excerpt ? <span className="msg-item-excerpt">{excerpt}</span> : null}
        </span>
        {postId ? <i className="fa fa-angle-right msg-item-arrow" aria-hidden="true" /> : null}
      </button>
    );
  };

  const renderSystem = (item: any, index: number) => {
    const isChangelog = item?.type === "changelog";
    const link = item?.link || "";
    return (
      <div
        key={`system-${item?.id ?? index}`}
        className={`msg-item msg-item-system${index < dotBudget ? " is-unread" : ""}${link ? " is-link" : ""}`}
        role={link ? "link" : undefined}
        tabIndex={link ? 0 : undefined}
        onClick={() => openMessageLink(link)}
        onKeyDown={(event) => {
          if (!link) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMessageLink(link);
          }
        }}
      >
        <span className={`msg-item-avatar msg-system-icon${isChangelog ? " is-changelog" : ""}`} aria-hidden="true">
          <i className={`fa ${isChangelog ? "fa-rocket" : "fa-bullhorn"}`} />
        </span>
        <div className="msg-item-main">
          <div className="msg-item-head">
            <span className="msg-item-name">{item?.title || "系统通知"}</span>
            {isChangelog ? <span className="msg-kind msg-kind-version">版本更新</span> : null}
            <span className="msg-item-time">{timeAgo(item?.created_at)}</span>
            {unreadDot(index < dotBudget)}
          </div>
          {item?.body_html ? (
            <div className="msg-item-body msg-rich">
              <RichContent html={item.body_html} format="html" />
            </div>
          ) : null}
        </div>
        {link ? <i className="fa fa-angle-right msg-item-arrow" aria-hidden="true" /> : null}
      </div>
    );
  };

  const renderChatBubble = (message: any) => {
    const isAdmin = message?.sender_type === "admin";
    const mine = !isAdmin;
    const name = message?.sender_name || (isAdmin ? "管理团队" : "我");
    const avatar = message?.sender_avatar || (mine ? user?.avatar || "" : "");
    return (
      <div key={String(message?.id)} className={`msg-chat-row ${mine ? "me" : "them"}`}>
        <span className="msg-chat-avatar">
          <Avatar src={avatar} name={name} size={36} />
        </span>
        <div className="msg-chat-main">
          <div className="msg-chat-meta">
            <span className="msg-chat-name">{name}</span>
            {isAdmin ? <span className="msg-chat-tag">管理团队</span> : null}
            <span className="msg-chat-time">{timeAgo(message?.created_at)}</span>
          </div>
          <div className="msg-chat-bubble">
            <div className="msg-chat-rich">
              <RichContent html={message?.content_html || message?.content} format={message?.content_format || "html"} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderList = () => {
    if (loading) return <MessageSkeleton />;
    if (error) {
      return (
        <StateBlock
          icon="fa-exclamation-circle"
          text="消息加载失败"
          hint={error}
          action="重试"
          onAction={() => void load(true)}
        />
      );
    }
    if (items.length === 0) {
      return <StateBlock icon={meta.icon} text={meta.empty} hint="有新消息时会在这里提醒你" />;
    }
    return (
      <div className="msg-list">
        {items.map((item, index) => {
          if (tab === "likes") return renderLike(item, index);
          if (tab === "comments") return renderComment(item, index);
          return renderSystem(item, index);
        })}
        {hasMore ? (
          <div className="msg-load-more">
            <button type="button" onClick={() => void load(false)} disabled={loadingMore}>
              {loadingMore ? (
                <>
                  <i className="fa fa-spinner fa-spin" aria-hidden="true" /> 加载中...
                </>
              ) : (
                "加载更多"
              )}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderChat = () => {
    return (
      <div className="msg-chat">
        <div className="msg-chat-notice">
          <i className="fa fa-shield" aria-hidden="true" /> 仅你与论坛管理团队可见
        </div>
        {loading ? (
          <ChatSkeleton />
        ) : error ? (
          <StateBlock
            icon="fa-exclamation-circle"
            text="会话加载失败"
            hint={error}
            action="重试"
            onAction={() => void load(true)}
          />
        ) : items.length === 0 ? (
          <StateBlock icon="fa-comments-o" text="还没有消息" hint="给管理团队留言，我们会尽快回复" />
        ) : (
          <div className="msg-chat-list" ref={chatListRef} onScroll={handleChatScroll} aria-live="polite">
            {hasMore ? (
              <div className="msg-chat-more">
                <button type="button" onClick={() => void loadOlderChat()} disabled={loadingMore}>
                  {loadingMore ? "加载中..." : "加载更早消息"}
                </button>
              </div>
            ) : null}
            {chatMessages.map((message) => renderChatBubble(message))}
          </div>
        )}
        <div className="msg-chat-composer">
          <div className="msg-chat-compose">
            <textarea
              value={draft}
              rows={2}
              maxLength={2000}
              aria-label="管理团队会话输入框"
              placeholder="输入消息，与管理团队沟通…"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type="button"
              className="btn primary msg-chat-send"
              disabled={sending || !draft.trim()}
              onClick={() => void sendChat()}
            >
              {sending ? "发送中…" : "发送"}
            </button>
          </div>
          <div className="msg-chat-foot">
            <i className="fa fa-clock-o" aria-hidden="true" /> 发送间隔 2 秒 · 最多 2000 字
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="msg-page app-msg-page">
      <div className={`msg-shell${tab === "chat" ? " is-chat-view" : ""}`}>
        <aside className="msg-sidebar">
          <div className="msg-sidebar-head">
            <h1 className="msg-sidebar-title">
              <i className="fa fa-envelope-o" aria-hidden="true" /> 消息中心
            </h1>
            <p className="msg-sidebar-sub">赞、评论与官方消息</p>
          </div>
          <nav className="msg-type-list" aria-label="消息类型">
            {TABS.map((entry) => {
              const count = unreadOf(entry.key, unread);
              const active = entry.key === tab;
              return (
                <button
                  key={entry.key}
                  type="button"
                  className={`msg-type-item${active ? " active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setTab(entry.key)}
                >
                  <i className={`fa ${entry.icon} msg-type-icon`} aria-hidden="true" />
                  <span className="msg-type-label">{entry.label}</span>
                  {count > 0 ? (
                    <span className="msg-type-badge" aria-label={`${count} 条未读`}>
                      {badgeText(count)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div className={`msg-conn ${conn}`} title={CONN_LABEL[conn]}>
            <span className="msg-conn-dot" aria-hidden="true" />
            {CONN_LABEL[conn]}
          </div>
        </aside>

        <section className="msg-detail">
          <header className="msg-detail-head">
            {tab === "chat" ? (
              <button type="button" className="msg-chat-back" onClick={() => setTab(listTabRef.current)} aria-label="返回消息中心">
                <i className="fa fa-angle-left" aria-hidden="true" /> 返回
              </button>
            ) : null}
            <div className="msg-detail-heading">
              <h2 className="msg-detail-title">{meta.title}</h2>
              <span className="msg-detail-sub">{meta.subtitle}</span>
            </div>
            <button
              type="button"
              className="msg-refresh-btn"
              onClick={() => {
                void load(true, true);
                void refreshUnread();
              }}
              title="刷新"
              aria-label="刷新消息"
            >
              <i className="fa fa-refresh" aria-hidden="true" />
            </button>
          </header>

          {conn === "degraded" ? (
            <div className="msg-stream-note" role="status">
              <i className="fa fa-exclamation-triangle" aria-hidden="true" /> 实时连接中断，已切换为每 15 秒轮询
            </div>
          ) : null}

          <div className={`msg-detail-body${tab === "chat" ? " is-chat" : ""}`}>
            {tab === "chat" ? renderChat() : renderList()}
          </div>
        </section>
      </div>
    </div>
  );
}
