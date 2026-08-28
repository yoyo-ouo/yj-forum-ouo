"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Header, { showCenterCard } from "@/components/Header";
import { worldApi, WorldMessage, ApiException } from "@/lib/api";
import { useStore } from "@/lib/store";

export default function WorldPage() {
  const router = useRouter();
  const { userId } = useStore();
  const [messages, setMessages] = useState<WorldMessage[]>([]);
  const [content, setContent] = useState("");
  const [connected, setConnected] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await worldApi.messages();
      setMessages(r || []);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000); // 3s 轮询（对齐原 2s+缓存）
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (!userId) return router.push("/login");
    if (!content.trim()) return;
    try {
      await worldApi.send(content.trim());
      setContent("");
      await load();
    } catch (e) {
      showCenterCard(`<p>${e instanceof ApiException ? e.message : "发送失败"}</p>`);
    }
  };

  return (
    <>
      <Header />
      <div className="forum-container" style={{ maxWidth: 800 }}>
        <div className="forum-header">
          <h1 className="forum-title">世界频道</h1>
          <p className="forum-subtitle">和小伙伴们一起聊天</p>
        </div>

        <div className="world-chat-box" ref={listRef} style={{ height: 480, overflowY: "auto", border: "1px solid var(--color-border, #ddd)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {!connected ? (
            <div className="forum-loading">连接中...</div>
          ) : messages.length === 0 ? (
            <div className="forum-loading">世界静悄悄，快来打破沉默~</div>
          ) : (
            [...messages].reverse().map((m) => (
              <div className="world-msg" key={m.id}>
                <span className="world-msg-sender">{m.sender_name}</span>
                <span className="world-msg-content">{m.content}</span>
                {m.created_at && <span className="world-msg-time">{new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
            ))
          )}
        </div>

        <div className="world-send-bar" style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            className="form-editor"
            placeholder={userId ? "说点什么..." : "登录后参与聊天"}
            value={content}
            disabled={!userId}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="submit-button" disabled={!userId} onClick={send}>
            <i className="fa fa-paper-plane"></i> 发送
          </button>
        </div>
      </div>
    </>
  );
}
