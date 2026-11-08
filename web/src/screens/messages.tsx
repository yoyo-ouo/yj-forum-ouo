import React, { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { api, ApiError } from "../lib/api";
import { openExternal, mediaUrl, requestApi, sse } from "../lib/native";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { Avatar, EmptyState, LoadMore, Loading, TopBar } from "../components/ui";
import { stripHtml, timeAgo } from "../lib/format";

type MessageTab = "likes" | "comments" | "system" | "chat";
type MessageCategory = "likes" | "comments" | "system";

const TABS: { key: MessageTab; label: string }[] = [
  { key: "likes", label: "赞" },
  { key: "comments", label: "评论" },
  { key: "system", label: "系统" },
  { key: "chat", label: "管理团队" },
];

const EMPTY_TEXT: Record<MessageTab, string> = {
  likes: "还没有人给你点赞",
  comments: "还没有收到评论",
  system: "暂无系统通知",
  chat: "还没有和管理团队的对话",
};

type SseListener = Awaited<ReturnType<typeof sse.addListener>>;

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

/** 富文本净化：保留气泡自身的颜色（因此不用 RichContent），并把站内相对图片换成可访问地址。 */
function sanitizeMessageHtml(html?: string | null): string {
  const clean = DOMPurify.sanitize(html || "");
  return clean.replace(/(<img\b[^>]*?\bsrc=")([^"]*)"/gi, (match, prefix: string, src: string) => {
    if (!src || /^(https?:|data:|blob:)/i.test(src)) return match;
    return `${prefix}${src.startsWith("/") ? mediaUrl(src) : src}"`;
  });
}

function likeAction(targetType?: string): string {
  if (targetType === "post") return "赞了你的帖子";
  if (targetType === "character") return "赞了你的设定";
  return "赞了你的评论";
}

export function MessagesScreen() {
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const setUnread = useApp((s) => s.setUnread);
  const { push } = useNav();
  const [tab, setTab] = useState<MessageTab>("likes");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /** 进入 tab 时的未读预算：前 N 条显示未读点（上报已读后徽标清零，点仍保留）。 */
  const [dots, setDots] = useState<Record<MessageTab, number>>({ likes: 0, comments: 0, system: 0, chat: 0 });
  const cursorRef = useRef<string | undefined>(undefined);
  const requestIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
      try {
        const cursor = reset ? undefined : cursorRef.current;
        const res: any = tab === "chat" ? await api.messagesChat(cursor) : await api.messagesCategory(tab, cursor);
        if (requestId !== requestIdRef.current) return;
        const incoming: any[] = Array.isArray(res?.items) ? res.items : [];
        setItems((current) => (reset ? incoming : [...current, ...incoming]));
        setHasMore(Boolean(res?.has_more));
        cursorRef.current = res?.next_cursor ? String(res.next_cursor) : undefined;
        if (tab === "chat") {
          const lastId = incoming.reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0);
          void markChatRead(lastId);
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "消息加载失败");
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
    void load(true);
  }, [load, user?.id]);

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

  // SSE：订阅 /messages/stream，收到新消息/未读事件时刷新当前列表与徽标。
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    let handle: SseListener | null = null;
    const onEvent = (payload: any) => {
      if (!active) return;
      if (payload?.channel && payload.channel !== "messages") return;
      if (payload?.state) return;
      const type = String(payload?.event || "message");
      if (type === "hello" || type === "heartbeat") return;
      void loadRef.current(true, true);
      void refreshUnread();
    };
    void sse
      .addListener("sse", onEvent)
      .then((listener) => {
        if (active) handle = listener;
        else void listener.remove();
      })
      .catch(() => undefined);
    void sse.start({ channel: "messages" }).catch(() => undefined);
    return () => {
      active = false;
      void handle?.remove();
      handle = null;
      void sse.stop({ channel: "messages" }).catch(() => undefined);
    };
  }, [refreshUnread, user?.id]);

  // 聊天窗口：只有出现更新的消息时才滚到底部（加载更早消息不跳动）。
  const newestChatIdRef = useRef(0);
  useEffect(() => {
    if (tab !== "chat" || items.length === 0) return;
    const newest = Number(items[0]?.id) || 0;
    if (newest === newestChatIdRef.current) return;
    newestChatIdRef.current = newest;
    const node = scrollRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, [tab, items]);

  const openMessageLink = (link?: string) => {
    if (!link) return;
    const postId = link.match(/^\/post\/([^/?#]+)/)?.[1];
    if (postId) {
      push("post", { id: postId });
      return;
    }
    void openExternal(link);
  };

  const sendChat = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.sendChat(plainTextToHtml(text));
      setDraft("");
      await load(true, true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        showToast("发送太快，稍后再试", "error");
      } else {
        showToast(err instanceof Error ? err.message : "发送失败", "error");
      }
    } finally {
      setSending(false);
    }
  };

  if (!user) {
    return (
      <div className="screen">
        <TopBar title="消息" />
        <EmptyState
          text="登录后查看点赞、评论与系统消息"
          action={<button className="btn primary" onClick={() => push("auth")}>去登录</button>}
        />
      </div>
    );
  }

  const dotBudget = tab === "chat" ? 0 : dots[tab] || 0;
  const visibleItems = tab === "chat" ? [...items].reverse() : items;

  const unreadDot = (show: boolean) =>
    show ? <i style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#ef4444" }} /> : null;

  const renderLike = (item: any, index: number) => (
    <div
      key={`like-${item?.id ?? index}`}
      className="msg-item"
      onClick={() => {
        if (item?.target_type === "character" && item?.target_id) {
          push("character-detail", { id: item.target_id });
          return;
        }
        if (item?.post_id) push("post", { id: item.post_id });
      }}
    >
      <Avatar src={item?.actor?.avatar} name={item?.actor?.name} size={36} />
      <div className="msg-body">
        <div className="msg-title">{`${item?.actor?.name || "有人"} ${likeAction(item?.target_type)}`}</div>
        <div className="msg-text">{[item?.post_title || item?.target_title, item?.comment_excerpt].filter(Boolean).join(" · ") || "查看详情"}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <span className="msg-time">{timeAgo(item?.created_at)}</span>
        {unreadDot(index < dotBudget)}
      </div>
    </div>
  );

  const renderComment = (item: any, index: number) => (
    <div
      key={`comment-${item?.id ?? index}`}
      className="msg-item"
      onClick={() => item?.post_id && push("post", { id: item.post_id })}
    >
      <Avatar src={item?.actor?.avatar} name={item?.actor?.name} size={36} />
      <div className="msg-body">
        <div className="msg-title">{`${item?.actor?.name || "有人"} ${item?.parent_id ? "回复了你的评论" : "评论了你的帖子"}`}</div>
        <div className="msg-text">{[item?.post_title, item?.excerpt].filter(Boolean).join(" · ") || "查看详情"}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <span className="msg-time">{timeAgo(item?.created_at)}</span>
        {unreadDot(index < dotBudget)}
      </div>
    </div>
  );

  const renderSystem = (item: any, index: number) => {
    const body = stripHtml(item?.body_html);
    return (
      <div key={`system-${item?.id ?? index}`} className="msg-item" onClick={() => openMessageLink(item?.link)}>
        <span className="avatar" style={{ width: 36, height: 36, fontSize: 16 }}>📢</span>
        <div className="msg-body">
          <div className="msg-title">{item?.title || "系统通知"}</div>
          <div className="msg-text">{body || "查看详情"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span className="msg-time">{timeAgo(item?.created_at)}</span>
          {unreadDot(index < dotBudget)}
        </div>
      </div>
    );
  };

  const renderChat = (item: any, index: number) => {
    const mine = item?.sender_type === "user";
    const name = item?.sender_name || (mine ? "我" : "管理团队");
    const html = sanitizeMessageHtml(item?.content_html);
    return (
      <div key={`chat-${item?.id ?? index}`} className={`world-msg ${mine ? "mine" : ""}`}>
        <Avatar src={item?.sender_avatar} name={name} size={30} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
          <div className="world-meta">
            {name}
            {item?.created_at ? ` · ${timeAgo(item.created_at)}` : ""}
          </div>
          <div className="world-bubble" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    );
  };

  const renderItem = (item: any, index: number) => {
    if (tab === "likes") return renderLike(item, index);
    if (tab === "comments") return renderComment(item, index);
    if (tab === "system") return renderSystem(item, index);
    return renderChat(item, index);
  };

  return (
    <div className="world-page">
      <TopBar title="消息" />
      <div className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            className={`tab-item ${tab === entry.key ? "on" : ""}`}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div
        className="world-scroll"
        ref={scrollRef}
        style={tab === "chat" ? undefined : { padding: "4px 0 18px" }}
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <EmptyState text={error} action={<button className="btn primary" onClick={() => void load(true)}>重试</button>} />
        ) : visibleItems.length === 0 ? (
          <EmptyState text={EMPTY_TEXT[tab]} />
        ) : (
          <>
            {tab === "chat" && hasMore ? <LoadMore loading={loadingMore} hasMore onClick={() => void load(false)} /> : null}
            {visibleItems.map((item, index) => renderItem(item, index))}
            {tab === "chat" ? null : <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void load(false)} />}
          </>
        )}
      </div>
      {tab === "chat" ? (
        <div className="world-input">
          <textarea
            value={draft}
            rows={1}
            maxLength={2000}
            placeholder="和管理团队说点什么…"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="btn primary" disabled={sending || !draft.trim()} onClick={() => void sendChat()}>
            {sending ? "发送中…" : "发送"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
