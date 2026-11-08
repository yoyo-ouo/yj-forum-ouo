import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { fetchMedia, openExternal, pickImage, requestApi, sse, uploadImage } from "../lib/native";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { AppBar, Avatar, Empty, IconButton, Screen, Segmented, Skeletons } from "../components/mobile";
import { Icon, type IconName } from "../components/icons";
import { RichContent } from "../components/ui";
import { stripHtml, timeAgo } from "../lib/format";

/**
 * 消息中心（底部 Tab 一级页）。
 * 移动端重做：分段切换 赞 / 评论 / 系统 / 团队，列表项统一「左侧头像或图标块 38 + 右侧
 * 标题 13.5 / 正文 12.5 两行 / 时间 11」，未读带左侧主色竖条与微高亮。
 * 业务侧保留：summary/likes/comments/system/chat 接口、分类已读上报、全部已读、
 * 团队会话发送、SSE 订阅与断线 15 秒轮询兜底。
 */

type MessageTab = "all" | "likes" | "comments" | "system" | "chat";
type MessageCategory = "likes" | "comments" | "system";

/** 「全部」汇总的分页游标（三类各自游标；done 后不再请求，避免重复拉首页） */
type AllCursor = {
  likes: { cursor?: string; done: boolean };
  comments: { cursor?: string; done: boolean };
  system: { cursor?: string; done: boolean };
};

const EMPTY_ALL_CURSOR = (): AllCursor => ({
  likes: { done: false },
  comments: { done: false },
  system: { done: false },
});

interface TabMeta {
  key: MessageTab;
  label: string;
  icon: IconName;
  empty: string;
  hint: string;
}

const TABS: TabMeta[] = [
  { key: "all", label: "全部", icon: "grid", empty: "还没有消息", hint: "点赞、评论与系统通知都会汇总在这里" },
  { key: "likes", label: "赞", icon: "heart", empty: "还没有收到赞", hint: "有人点赞你的帖子或评论时会出现在这里" },
  { key: "comments", label: "评论", icon: "comment", empty: "还没有评论消息", hint: "帖子下的新评论与回复会出现在这里" },
  { key: "system", label: "系统", icon: "bell", empty: "暂无系统通知", hint: "站内公告与系统提醒会出现在这里" },
  { key: "chat", label: "团队", icon: "shield", empty: "还没有团队消息", hint: "给管理团队留言，我们会尽快回复" },
];

type SseListener = Awaited<ReturnType<typeof sse.addListener>>;
type ConnState = "connecting" | "online" | "offline";

const CONN_TEXT: Record<ConnState, string> = {
  connecting: "连接中",
  online: "在线",
  offline: "已断开",
};

const CONN_TITLE: Record<ConnState, string> = {
  connecting: "正在连接消息中心",
  online: "消息中心已连接",
  offline: "消息中心暂时断开，正在自动重试",
};

/** 服务端 2 秒/用户限流 */
const SEND_COOLDOWN_MS = 2000;
/** 断线降级轮询间隔（对齐 Web useMessageStream） */
const POLL_INTERVAL_MS = 15_000;
const MAX_CHAT_CHARS = 2000;

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

function likeVerb(targetType?: string): string {
  if (targetType === "post") return "赞了你的帖子";
  if (targetType === "character") return "赞了你的设定";
  return "赞了你的评论";
}

function unreadOf(type: MessageTab, unread: { likes: number; comments: number; system: number; chat: number }): number {
  if (type === "all") return 0;
  if (type === "chat") return unread.chat;
  return unread[type];
}

/** 「全部」：三类消息按时间倒序合并，按 kind+id 去重 */
function mergeAllItems(groups: Array<{ kind: MessageCategory; items: any[] }>, previous: any[]): any[] {
  const map = new Map<string, any>();
  previous.forEach((item) => {
    if (item?.id === undefined || item?.id === null) return;
    map.set(`${item.__kind}:${item.id}`, item);
  });
  groups.forEach(({ kind, items }) => {
    (items || []).forEach((item) => {
      if (!item || item.id === undefined || item.id === null) return;
      map.set(`${kind}:${item.id}`, { ...item, __kind: kind });
    });
  });
  return [...map.values()].sort(
    (a, b) => (Date.parse(String(b?.created_at || "")) || 0) - (Date.parse(String(a?.created_at || "")) || 0),
  );
}

function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** 统一的列表项：左侧 lead（头像或图标块）+ 右侧标题 / 正文 / 时间。 */
function MessageRow({
  unread,
  leading,
  title,
  body,
  rich,
  time,
  tag,
  onClick,
  onLeadingClick,
  leadingLabel,
  label,
}: {
  unread: boolean;
  leading: React.ReactNode;
  title: string;
  body?: string;
  /** 带图片等富文本内容时优先渲染（聊天消息的私有图片） */
  rich?: React.ReactNode;
  time?: string;
  tag?: React.ReactNode;
  onClick?: () => void;
  onLeadingClick?: () => void;
  leadingLabel?: string;
  label?: string;
}) {
  const clickable = Boolean(onClick);
  return (
    <div
      className={`ms-item${unread ? " is-unread" : ""}${clickable ? " is-link" : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={label || title}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!clickable) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      {onLeadingClick ? (
        <button
          type="button"
          className="ms-lead ms-lead--btn"
          aria-label={leadingLabel || "查看资料"}
          onClick={(event) => {
            event.stopPropagation();
            onLeadingClick();
          }}
        >
          {leading}
        </button>
      ) : (
        <span className="ms-lead">{leading}</span>
      )}
      <div className="ms-item-body">
        <div className="ms-item-title">
          <span className="ms-item-title-txt">{title}</span>
          {tag}
        </div>
        {rich ? <div className="ms-item-rich">{rich}</div> : body ? <div className="ms-item-text">{body}</div> : null}
        {time ? <div className="ms-item-time">{time}</div> : null}
      </div>
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
  const [uploadingImage, setUploadingImage] = useState(false);
  const [conn, setConn] = useState<ConnState>("connecting");
  /** 进入 tab 时的未读预算：告警清零后，本次浏览仍保留未读标记。 */
  const [dots, setDots] = useState<Record<MessageTab, number>>({ all: 0, likes: 0, comments: 0, system: 0, chat: 0 });

  const cursorRef = useRef<string | undefined>(undefined);
  /** 「全部」的三类游标（与普通 tab 的 cursorRef 互不影响） */
  const allCursorRef = useRef<AllCursor>(EMPTY_ALL_CURSOR());
  const requestIdRef = useRef(0);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
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
        if (tab === "all") {
          // 首屏用 api.messagesAll；后续页按三类游标各取下一页（游标用尽即停止）
          const state: AllCursor = reset ? EMPTY_ALL_CURSOR() : allCursorRef.current;
          let data: any;
          if (reset) {
            data = await api.messagesAll();
          } else {
            const query: Record<string, string> = {};
            if (state.likes.cursor) query.likes_cursor = state.likes.cursor;
            if (state.comments.cursor) query.comments_cursor = state.comments.cursor;
            if (state.system.cursor) query.system_cursor = state.system.cursor;
            const res = await requestApi<any>({ method: "GET", path: "/messages/all", query });
            if (!res.ok || res.data?.success === false) {
              throw new Error(String(res.data?.message || "消息加载失败"));
            }
            data = res.data;
          }
          if (requestId !== requestIdRef.current) return;
          const next: AllCursor = {
            likes: { ...state.likes },
            comments: { ...state.comments },
            system: { ...state.system },
          };
          const groups = (["likes", "comments", "system"] as MessageCategory[])
            .filter((kind) => !state[kind].done)
            .map((kind) => {
              const page = data?.[kind];
              next[kind] = {
                cursor: page?.next_cursor ? String(page.next_cursor) : undefined,
                done: !page?.has_more,
              };
              return { kind, items: Array.isArray(page?.items) ? (page.items as any[]) : [] };
            });
          allCursorRef.current = next;
          setItems((current) => mergeAllItems(groups, reset ? [] : current));
          setHasMore(!next.likes.done || !next.comments.done || !next.system.done);
          return;
        }
        const cursor = reset ? undefined : cursorRef.current;
        const res: any =
          tab === "chat" ? await api.messagesChat(cursor) : await api.messagesCategory(tab, cursor);
        if (requestId !== requestIdRef.current) return;
        const incoming: any[] = Array.isArray(res?.items)
          ? res.items
          : Array.isArray(res?.comments)
            ? res.comments
            : [];
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
    allCursorRef.current = EMPTY_ALL_CURSOR();
    setItems([]);
    setHasMore(false);
    setError("");
    setDraft("");
    void load(true);
  }, [load, user?.id]);

  // 切换 tab：记录未读预算，非团队 tab 立即上报已读并刷新全局未读数。
  useEffect(() => {
    if (!user?.id) return;
    // 「全部」是汇总视图，不代用户上报已读（避免误清未读）
    if (tab === "all") return;
    if (tab === "chat") {
      const snapshot = useApp.getState().unread.chat || 0;
      setDots((current) => (current.chat > 0 ? current : { ...current, chat: snapshot }));
      return;
    }
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
        setConn("offline");
        return;
      }
      const type = String(payload?.event || "message");
      if (type === "heartbeat") return;
      if (type === "hello") {
        setConn("online");
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
        setConn("online");
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
      setConn("online");
    };
    const onState = (payload: any) => {
      if (!active) return;
      if (payload?.channel && payload.channel !== "messages") return;
      setConn(payload?.state === "connected" ? "online" : "offline");
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
    if (!user?.id || conn !== "offline") return;
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

  // 团队会话：贴底时才跟随新消息滚动（加载更早消息不跳动）。
  useEffect(() => {
    if (tab !== "chat" || !stickRef.current) return;
    const node = chatScrollRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, [tab, items]);

  // 团队输入框自适应高度：38（一行）到 96（约四行）。
  useEffect(() => {
    const node = chatInputRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(96, Math.max(38, node.scrollHeight))}px`;
  }, [draft, tab]);

  const handleChatScroll = () => {
    const node = chatScrollRef.current;
    if (!node) return;
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
  };

  const loadOlderChat = async () => {
    const node = chatScrollRef.current;
    const previousHeight = node?.scrollHeight ?? 0;
    const previousTop = node?.scrollTop ?? 0;
    stickRef.current = false;
    await load(false);
    requestAnimationFrame(() => {
      const scrubber = chatScrollRef.current;
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

  const markAllRead = async () => {
    if (!user?.id) return;
    const now = new Date().toISOString();
    try {
      await Promise.all([
        api.markRead("likes", now),
        api.markRead("comments", now),
        api.markRead("system", now),
      ]);
      const chatRes: any = await api.messagesChat().catch(() => null);
      const lastChatId = (Array.isArray(chatRes?.items) ? chatRes.items : []).reduce(
        (max: number, item: any) => Math.max(max, Number(item?.id) || 0),
        0,
      );
      if (lastChatId) {
        await requestApi({ method: "POST", path: "/messages/chat/read", body: { last_message_id: lastChatId } }).catch(
          () => undefined,
        );
      }
      setDots({ all: 0, likes: 0, comments: 0, system: 0, chat: 0 });
      await refreshUnread();
      showToast("已全部标记为已读");
    } catch {
      showToast("操作失败，请稍后再试", "error");
    }
  };

  /** 发送 HTML 消息（文本 / 纯图片共用）：返回是否真的发出去了 */
  const postChat = async (html: string): Promise<boolean> => {
    if (sendingRef.current) return false;
    const now = Date.now();
    if (now - lastSentRef.current < SEND_COOLDOWN_MS) {
      const seconds = Math.max(1, Math.ceil((SEND_COOLDOWN_MS - (now - lastSentRef.current)) / 1000));
      showToast(`发送太快，请 ${seconds} 秒后再试`, "error");
      return false;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      const res: any = await api.sendChat(html);
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
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        lastSentRef.current = Date.now();
        showToast("发送太快，稍后再试", "error");
      } else {
        showToast(err instanceof Error && err.message ? err.message : "发送失败", "error");
      }
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const sendChat = async () => {
    if (sendingRef.current) return;
    const text = draft.trim();
    if (!text) return;
    const ok = await postChat(plainTextToHtml(text));
    if (ok) setDraft("");
  };

  /** 图片消息：相册选图 → 上传（scene=chat_message）→ 直接发图片消息（允许纯图片） */
  const sendChatImage = async () => {
    if (sendingRef.current) return;
    try {
      const picked = await pickImage("gallery");
      setUploadingImage(true);
      const res = await uploadImage(picked.path, "chat_message");
      const data: any = res.data;
      if (!res.ok || data?.success === false) throw new Error(data?.message || "图片上传失败");
      const src = data?.id ? `/ov2/api/media/${data.id}` : data?.url ? String(data.url) : "";
      if (!src) throw new Error("图片上传失败");
      await postChat(`<p><img src="${src}" alt=""></p>`);
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "图片发送失败", "error");
    } finally {
      setUploadingImage(false);
    }
  };

  /** 私有图片解析：聊天图片受权限保护，需先经原生/带凭据的 fetch 拿到可渲染地址 */
  const resolveChatMedia = useCallback((src: string) => fetchMedia(src), []);

  if (!user) {
    return (
      <Screen className="ms-screen" appbar={<AppBar title="消息中心" />}>
        <Empty
          icon="mail"
          title="登录后查看消息"
          hint="点赞、评论与管理团队消息都在这里"
          action={
            <button type="button" className="m-btn m-btn--primary" onClick={() => push("auth")}>
              去登录
            </button>
          }
        />
      </Screen>
    );
  }

  const meta = TABS.find((entry) => entry.key === tab) || TABS[0];
  const dotBudget = tab === "chat" ? 0 : dots[tab] || 0;
  const chatDotBudget = dots.chat || 0;
  const chatMessages = [...items].sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0));
  const counterVisible = draft.length > 1400;

  const segItems = TABS.map((entry) => {
    const count = unreadOf(entry.key, unread);
    return {
      key: entry.key,
      label: (
        <span className="ms-seg-lbl">
          {entry.label}
          {count > 0 ? (
            <i className="ms-seg-num" aria-label={`${count} 条未读`}>
              {badgeText(count)}
            </i>
          ) : null}
        </span>
      ),
    };
  });

  const avatarLead = (src?: string | null, name?: string, badge?: IconName) => (
    <span className="ms-avatar">
      <Avatar src={src} name={name} size={38} />
      {badge ? (
        <i className="ms-avatar-badge" aria-hidden="true">
          <Icon name={badge} size={11} />
        </i>
      ) : null}
    </span>
  );

  const renderLike = (item: any, index: number) => {
    const actor = item?.actor?.name || item?.actor_name || "";
    const fallback = item?.title || "";
    const title = actor ? `${actor} ${likeVerb(item?.target_type)}` : fallback || "有人赞了你";
    const body = item?.comment_excerpt || item?.post_title || item?.target_title || item?.text || "";
    const isCharacter = item?.target_type === "character" && item?.target_id;
    const postId = item?.post_id;
    const actorId = item?.actor?.id ? String(item.actor.id) : "";
    const clickable = Boolean(isCharacter || postId);
    return (
      <MessageRow
        key={`like-${item?.id ?? index}`}
        unread={index < dotBudget}
        leading={avatarLead(item?.actor?.avatar, actor || "有人", "heart")}
        title={title}
        body={body}
        time={timeAgo(item?.created_at)}
        label={`${title}${body ? `：${body}` : ""}`}
        leadingLabel={`${actor || "有人"} 的个人主页`}
        onLeadingClick={actorId ? () => push("user", { id: actorId }) : undefined}
        onClick={
          clickable
            ? () => {
                if (isCharacter) {
                  push("character-detail", { id: String(item.target_id) });
                  return;
                }
                push("post", { id: String(postId) });
              }
            : undefined
        }
      />
    );
  };

  const renderComment = (item: any, index: number) => {
    const actor = item?.actor?.name || item?.user_name || item?.actor_name || "";
    const fallback = item?.title || "";
    const title = actor ? `${actor} ${item?.parent_id ? "回复了你的评论" : "评论了你的帖子"}` : fallback || "收到新评论";
    const body =
      item?.excerpt || item?.post_title || item?.text || stripHtml(item?.content) || "";
    const postId = item?.post_id;
    const actorId = item?.actor?.id ? String(item.actor.id) : item?.user_id ? String(item.user_id) : "";
    return (
      <MessageRow
        key={`comment-${item?.id ?? index}`}
        unread={index < dotBudget}
        leading={avatarLead(item?.actor?.avatar || item?.user_avatar, actor || "有人", "comment")}
        title={title}
        body={body}
        time={timeAgo(item?.created_at)}
        label={`${title}${body ? `：${body}` : ""}`}
        leadingLabel={`${actor || "有人"} 的个人主页`}
        onLeadingClick={actorId ? () => push("user", { id: actorId }) : undefined}
        onClick={postId ? () => push("post", { id: String(postId) }) : undefined}
      />
    );
  };

  const renderSystem = (item: any, index: number) => {
    const isChangelog = item?.type === "changelog";
    const link = item?.link || "";
    const body = stripHtml(item?.body_html) || item?.text || "";
    return (
      <MessageRow
        key={`system-${item?.id ?? index}`}
        unread={index < dotBudget}
        leading={
          <span className="ms-icon ms-icon--system" aria-hidden="true">
            <Icon name={isChangelog ? "download" : "bell"} size={18} />
          </span>
        }
        title={item?.title || "系统通知"}
        body={body}
        time={timeAgo(item?.created_at)}
        tag={isChangelog ? <span className="ms-tag">版本</span> : undefined}
        label={item?.title || "系统通知"}
        onClick={link ? () => openMessageLink(link) : undefined}
      />
    );
  };

  const renderChatRow = (message: any, index: number) => {
    const isAdmin = message?.sender_type !== "user";
    const name = isAdmin ? message?.sender_name || "管理团队" : "我";
    const html = String(message?.content_html || message?.content || "");
    const body = stripHtml(html) || message?.text || "";
    const unreadMark = chatDotBudget > 0 && index >= chatMessages.length - chatDotBudget;
    // 带图片的消息交给 RichContent：私有媒体经 resolveMedia 换成可渲染地址
    const hasRichMedia = /<img\b/i.test(html);
    return (
      <MessageRow
        key={String(message?.id ?? index)}
        unread={unreadMark}
        leading={
          isAdmin ? (
            <span className="ms-icon ms-icon--team" aria-hidden="true">
              <Icon name="shield" size={18} />
            </span>
          ) : (
            avatarLead(message?.sender_avatar || user?.avatar, name)
          )
        }
        title={name}
        body={body}
        rich={hasRichMedia ? <RichContent html={html} format="html" resolveMedia={resolveChatMedia} /> : undefined}
        time={timeAgo(message?.created_at)}
        tag={isAdmin ? <span className="ms-tag">官方</span> : undefined}
        label={`${name}：${body}`}
      />
    );
  };

  const renderList = () => {
    if (loading) return <Skeletons count={5} />;
    if (error) {
      return (
        <Empty
          icon="info"
          title="消息加载失败"
          hint={error}
          action={
            <button type="button" className="m-btn m-btn--primary m-btn--sm" onClick={() => void load(true)}>
              重试
            </button>
          }
        />
      );
    }
    if (items.length === 0) return <Empty icon={meta.icon} title={meta.empty} hint={meta.hint} />;
    return (
      <>
        <div className="ms-list">
          {items.map((item, index) => {
            // 「全部」：按合并时打上的 __kind 分发到各自的渲染器
            const kind: MessageCategory =
              tab === "all" ? ((item?.__kind as MessageCategory) || "system") : (tab as MessageCategory);
            if (kind === "likes") return renderLike(item, index);
            if (kind === "comments") return renderComment(item, index);
            return renderSystem(item, index);
          })}
        </div>
        {hasMore ? (
          <button type="button" className="m-more" disabled={loadingMore} onClick={() => void load(false)}>
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        ) : (
          <div className="m-end">— 到底了 —</div>
        )}
      </>
    );
  };

  const renderChat = () => (
    <div className="ms-chatwrap">
      <div className="ms-chat-note">
        <Icon name="shield" size={12} /> 仅你与论坛管理团队可见
      </div>
      {loading ? (
        <Skeletons count={4} />
      ) : error ? (
        <Empty
          icon="info"
          title="会话加载失败"
          hint={error}
          action={
            <button type="button" className="m-btn m-btn--primary m-btn--sm" onClick={() => void load(true)}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <Empty icon="shield" title="还没有团队消息" hint="给管理团队留言，我们会尽快回复" />
      ) : (
        <>
          <div className="ms-chatscroll" ref={chatScrollRef} onScroll={handleChatScroll} aria-live="polite">
            <div className="ms-list ms-list--chat">
              {chatMessages.map((message, index) => renderChatRow(message, index))}
            </div>
            {hasMore ? (
              <button type="button" className="ms-chat-more" disabled={loadingMore} onClick={() => void loadOlderChat()}>
                {loadingMore ? "加载中…" : "加载更早消息"}
              </button>
            ) : (
              <div className="m-end">— 到底了 —</div>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <Screen
      className="ms-screen"
      bodyClassName={tab === "chat" ? "ms-body ms-body--chat" : "ms-body"}
      onRefresh={async () => {
        await Promise.all([load(true, true), refreshUnread()]);
      }}
      pullDisabled={tab === "chat"}
      appbar={
        <AppBar
          title="消息中心"
          actions={
            <>
              <span className={`ms-conn ms-conn--${conn}`} title={CONN_TITLE[conn]} role="status">
                <i className="ms-conn-dot" aria-hidden="true" />
                <span className="ms-conn-txt">{CONN_TEXT[conn]}</span>
              </span>
              <IconButton icon="check" label="全部已读" onClick={() => void markAllRead()} />
              <IconButton
                icon="refresh"
                label="刷新"
                onClick={() => {
                  void load(true, true);
                  void refreshUnread();
                }}
              />
            </>
          }
        />
      }
      footer={
        tab === "chat" ? (
          <div className="ms-composer">
            {counterVisible ? (
              <div className="ms-counter">
                {draft.length} / {MAX_CHAT_CHARS}
              </div>
            ) : null}
            <div className="ms-inputrow">
              <button
                type="button"
                className="ms-imgbtn"
                aria-label="发送图片"
                disabled={sending || uploadingImage}
                onClick={() => void sendChatImage()}
              >
                {uploadingImage ? <span className="m-spinner" /> : <Icon name="image" size={19} />}
              </button>
              <textarea
                ref={chatInputRef}
                className="ms-input"
                value={draft}
                rows={1}
                maxLength={MAX_CHAT_CHARS}
                aria-label="管理团队会话输入框"
                placeholder="给管理团队留言…"
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                type="button"
                className="ms-send"
                aria-label="发送"
                disabled={sending || !draft.trim()}
                onClick={() => void sendChat()}
              >
                <Icon name="send" size={19} />
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="ms-segwrap">
        <Segmented items={segItems} value={tab} onChange={setTab} className="ms-seg" />
      </div>
      {tab === "chat" ? renderChat() : renderList()}
    </Screen>
  );
}
