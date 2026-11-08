import React, { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { api, ApiError } from "../lib/api";
import { mediaUrl, sse } from "../lib/native";
import { useApp } from "../lib/store";
import { Avatar, EmptyState, Loading, TopBar } from "../components/ui";
import { timeAgo } from "../lib/format";

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
  is_admin?: boolean;
}

type SseListener = Awaited<ReturnType<typeof sse.addListener>>;

function messageUserId(item: WorldMessageItem): string {
  return String(item.sender_id ?? item.user_id ?? "");
}

function messageUserName(item: WorldMessageItem): string {
  return String(item.sender_name ?? item.user_name ?? "");
}

function messageUserAvatar(item: WorldMessageItem): string {
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

/** 富文本净化：保留气泡自身的颜色（因此不用 RichContent），并把站内相对图片换成可访问地址。 */
function sanitizeMessageHtml(html?: string | null): string {
  const clean = DOMPurify.sanitize(html || "");
  return clean.replace(/(<img\b[^>]*?\bsrc=")([^"]*)"/gi, (match, prefix: string, src: string) => {
    if (!src || /^(https?:|data:|blob:)/i.test(src)) return match;
    return `${prefix}${src.startsWith("/") ? mediaUrl(src) : src}"`;
  });
}

function timeValue(input?: string | null): number {
  if (!input) return 0;
  const value = Date.parse(input);
  return Number.isFinite(value) ? value : 0;
}

function sortAscending(list: WorldMessageItem[]): WorldMessageItem[] {
  return [...list].sort((a, b) => {
    const diff = timeValue(a.created_at) - timeValue(b.created_at);
    return diff !== 0 ? diff : Number(a.id) - Number(b.id);
  });
}

function mergeMessages(current: WorldMessageItem[], incoming: WorldMessageItem[]): WorldMessageItem[] {
  const map = new Map<string, WorldMessageItem>();
  current.forEach((item) => map.set(String(item.id), item));
  incoming.forEach((item) => map.set(String(item.id), item));
  return sortAscending([...map.values()]);
}

/** SSE data 可能是 JSON 字符串，也可能是对象；兼容 {message}/{item}/裸消息三种包裹。 */
function parseWorldPayload(payload: any): WorldMessageItem | null {
  const raw = payload?.data;
  let data: any = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
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

export function WorldScreen() {
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const [items, setItems] = useState<WorldMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) return;
      try {
        node.scrollTo({ top: node.scrollHeight, behavior: smooth ? "smooth" : "auto" });
      } catch {
        node.scrollTop = node.scrollHeight;
      }
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res: any = await api.worldMessages({ limit: 50 });
      setItems(sortAscending(Array.isArray(res?.items) ? res.items : []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "世界频道加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // SSE：订阅 world 频道新消息；卸载时移除监听并断开连接，避免重复连接。
  useEffect(() => {
    let active = true;
    let handle: SseListener | null = null;
    const onEvent = (payload: any) => {
      if (!active) return;
      if (payload?.channel && payload.channel !== "world") return;
      if (payload?.state) return;
      const type = String(payload?.event || "message");
      if (type !== "message") return;
      const incoming = parseWorldPayload(payload);
      if (!incoming) return;
      setItems((current) => mergeMessages(current, [incoming]));
    };
    void sse
      .addListener("sse", onEvent)
      .then((listener) => {
        if (active) handle = listener;
        else void listener.remove();
      })
      .catch(() => undefined);
    void sse.start({ channel: "world" }).catch(() => undefined);
    return () => {
      active = false;
      void handle?.remove();
      handle = null;
      void sse.stop({ channel: "world" }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [items, scrollToBottom]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (!user) {
      showToast("请先登录后参与世界频道", "error");
      return;
    }
    setSending(true);
    try {
      await api.sendWorld(plainTextToHtml(text));
      setDraft("");
      const lastId = items.length > 0 ? Number(items[items.length - 1].id) : 0;
      const res: any = await api.worldMessages(lastId > 0 ? { after_id: lastId, limit: 50 } : { limit: 50 });
      setItems((current) => mergeMessages(current, Array.isArray(res?.items) ? res.items : []));
      scrollToBottom(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        showToast("发言太快，稍后再试", "error");
      } else {
        showToast(err instanceof Error ? err.message : "发送失败", "error");
      }
    } finally {
      setSending(false);
    }
  };

  const myId = user?.id ? String(user.id) : "";

  return (
    <div className="world-page">
      <TopBar title="世界频道" />
      <div className="world-scroll" ref={scrollRef}>
        {loading ? (
          <Loading />
        ) : error ? (
          <EmptyState text={error} action={<button className="btn primary" onClick={() => void load()}>重新加载</button>} />
        ) : items.length === 0 ? (
          <EmptyState text="世界频道还很安静，来说第一句话吧" />
        ) : (
          items.map((item) => {
            const name = messageUserName(item) || "匿名";
            const mine = Boolean(myId) && messageUserId(item) === myId;
            const html = sanitizeMessageHtml(item.content);
            return (
              <div key={String(item.id)} className={`world-msg ${mine ? "mine" : ""}`}>
                <Avatar src={messageUserAvatar(item)} name={name} size={30} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
                  <div className="world-meta">
                    {name}
                    {item.is_admin ? " · 管理团队" : ""}
                    {item.created_at ? ` · ${timeAgo(item.created_at)}` : ""}
                  </div>
                  <div className="world-bubble" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="world-input">
        <textarea
          value={draft}
          rows={1}
          maxLength={2000}
          placeholder={user ? "在世界频道说点什么…" : "登录后即可参与世界频道…"}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="btn primary" disabled={sending || !draft.trim()} onClick={() => void send()}>
          {sending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}
