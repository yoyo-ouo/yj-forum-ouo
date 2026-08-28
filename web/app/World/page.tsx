"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { UserName } from "@/components/ui/UserAvatar";
import { worldApi, WorldMessage, ApiException } from "@/lib/api";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/constants";

export default function WorldPage() {
  const router = useRouter();
  const { userId, user } = useStore();
  const { toast } = useToast();
  const [messages, setMessages] = useState<WorldMessage[]>([]);
  const [content, setContent] = useState("");
  const [connected, setConnected] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null);
  const [running, setRunning] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const connectedRef = useRef(false);

  const load = useCallback(async () => {
    const t0 = performance.now();
    try {
      const r = await worldApi.messages();
      setMessages(r || []);
      setLatency(Math.round(performance.now() - t0));
      setConnected(true);
      if (!connectedRef.current) {
        connectedRef.current = true;
        toast("已连接", "success");
      }
    } catch {
      setConnected(false);
      setLatency(null);
      if (connectedRef.current) {
        connectedRef.current = false;
        toast("连接已断开", "error");
      }
    }
  }, [toast]);

  useEffect(() => {
    if (!running) return;
    load();
    const timer = setInterval(load, 3000); // 3s 轮询（对齐原 2s+缓存）
    return () => clearInterval(timer);
  }, [load, running]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (!userId) return router.push("/auth");
    if (!content.trim()) return;
    try {
      await worldApi.send(content.trim(), replyTo?.id);
      setContent("");
      setReplyTo(null);
      await load();
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "发送失败", "error");
    }
  };

  const toggleConnection = () => {
    if (running) {
      setRunning(false);
      setConnected(false);
      setLatency(null);
      connectedRef.current = false;
      toast("已断开", "info");
    } else {
      setRunning(true);
      toast("正在连接...", "info");
    }
  };

  const messageParent = useCallback(
    (m: WorldMessage) => {
      if (!m.parent_id) return null;
      return messages.find((x) => x.id === m.parent_id) || null;
    },
    [messages]
  );

  return (
    <>
      <div className="world-chat-container">
        <div className="world-chat-header">
          <h3><i className="fa fa-globe"></i> 世界频道</h3>
          <span className={`world-chat-status ${connected ? (latency !== null && latency > 300 ? "slow" : "on") : "off"}`} id="world-chat-status">
            {connected ? (latency !== null ? `已连接 · ${latency}ms` : "已连接") : "断开"}
          </span>
        </div>

        <div className="world-chat-messages" id="WorldMessageDOM" ref={listRef}>
          {messages.length === 0 ? (
            <div className="world-chat-empty">世界静悄悄，快来打破沉默~</div>
          ) : (
            [...messages]
              .sort((a, b) => Number(a.id) - Number(b.id))
              .map((m) => {
                const isMe = userId === m.sender_id;
                const parent = messageParent(m);
                return (
                  <div className={`world-msg ${isMe ? "world-msg-me" : ""}`} data-msg-id={m.id} key={m.id}>
                    <div className="world-msg-avatar">
                      {m.sender_avatar ? (
                        <Link href={`/users/${m.sender_id}`} className="world-msg-avatar-link">
                          <img src={m.sender_avatar} alt="" className="world-msg-avatar-img" />
                        </Link>
                      ) : (
                        <i className="fa fa-user world-msg-avatar-fa"></i>
                      )}
                    </div>
                    <div className="world-msg-body">
                      <div className="world-msg-header">
                        <div className="world-msg-name Username">
                          <UserName name={m.sender_name} userId={m.sender_id} />
                        </div>
                        <button className="world-msg-reply-btn" data-msg-id={m.id} title="引用回复" onClick={() => setReplyTo({ id: m.id, name: m.sender_name })}>
                          <i className="fa fa-reply"></i>
                        </button>
                      </div>
                      {parent && (
                        <div className="world-msg-reply">
                          <div className="world-reply-name Username">
                            <UserName name={parent.sender_name} userId={parent.sender_id} />
                          </div>
                          <div className="world-msg-bubble">{parent.content}</div>
                        </div>
                      )}
                      <div className="world-msg-bubble">{m.content}</div>
                      <div className="world-msg-time">{formatTime(m.created_at).split(" ").slice(1).join(" ")}</div>
                    </div>
                  </div>
                );
              })
          )}
        </div>

        <div className="world-chat-input-bar">
          {replyTo && (
            <div className="world-reply-indicator">
              <span>回复 @{replyTo.name}</span>
              <button onClick={() => setReplyTo(null)}><i className="fa fa-times"></i></button>
            </div>
          )}
          <input
            type="text"
            id="world-chat-input"
            placeholder={userId ? (replyTo ? `回复 ${replyTo.name}...` : "输入消息...") : "登录后参与聊天"}
            maxLength={500}
            value={content}
            disabled={!userId}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button id="world-chat-send" onClick={send} disabled={!userId}>
            <i className="fa fa-paper-plane"></i> 发送
          </button>
          <button id="world-chat-toggle" onClick={toggleConnection}>
            {running ? "断开" : "重新连接"}
          </button>
        </div>
      </div>
    </>
  );
}
