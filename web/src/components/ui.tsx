import React, { useEffect, useRef } from "react";
import { registerBackHandler } from "../lib/back";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { avatarUrl, categoryColor, categoryLabel, stripHtml, textLimit, timeAgo } from "../lib/format";
import type { Post } from "../lib/types";

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function TabIcon({ name }: { name: "square" | "world" | "messages" | "me" }) {
  if (name === "square") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </svg>
    );
  }
  if (name === "world") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
      </svg>
    );
  }
  if (name === "messages") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.5-4.5A8 8 0 1 1 21 12z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

export function Avatar({ src, name, size = 36 }: { src?: string | null; name?: string; size?: number }) {
  const url = avatarUrl(src);
  const initial = (name || "?").trim().slice(0, 1);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}>
      {url ? <img src={url} alt={name || ""} /> : <span>{initial}</span>}
    </span>
  );
}

export function TopBar({
  title,
  back = false,
  actions,
  children,
}: {
  title?: React.ReactNode;
  back?: boolean;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { pop } = useNav();
  return (
    <header className="topbar">
      {back ? (
        <button className="icon-btn back-btn" aria-label="返回" onClick={pop}>
          <BackIcon />
        </button>
      ) : null}
      <div className="topbar-title">{title}</div>
      {children}
      <div className="topbar-actions">{actions}</div>
    </header>
  );
}

export function Screen({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`screen ${className}`}>{children}</div>;
}

export function Loading({ text = "加载中…" }: { text?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  );
}

export function EmptyState({ text = "这里还没有内容", action }: { text?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark">◌</div>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function LoadMore({ loading, hasMore, onClick }: { loading?: boolean; hasMore?: boolean; onClick: () => void }) {
  if (!hasMore) return <div className="list-end">— 到底了 —</div>;
  return (
    <button className="load-more" onClick={onClick} disabled={loading}>
      {loading ? "加载中…" : "加载更多"}
    </button>
  );
}

export function RichContent({ html, format }: { html?: string | null; format?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const { push } = useNav();
  const raw = format === "markdown" ? (marked.parse(html || "") as string) : html || "";
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "rel"] });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (src.startsWith("/")) img.src = avatarUrl(src);
      img.loading = "lazy";
    });
    root.querySelectorAll("a").forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
  }, [clean]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-embed]"));
    if (nodes.length === 0) return;
    const groups: Record<string, string[]> = { user: [], post: [], article: [], character: [] };
    nodes.forEach((node) => {
      const type = node.dataset.embed || "";
      const id = node.dataset.id || "";
      if (id && groups[type]) groups[type].push(id);
    });
    let cancelled = false;
    void api
      .embeds({ users: groups.user, posts: groups.post, articles: groups.article, characters: groups.character })
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, any>();
        (res.users || []).forEach((item: any) => map.set(`user:${item.id}`, item));
        (res.posts || []).forEach((item: any) => map.set(`post:${item.id}`, item));
        (res.articles || []).forEach((item: any) => map.set(`article:${item.id}`, item));
        (res.characters || []).forEach((item: any) => map.set(`character:${item.id}`, item));
        nodes.forEach((node) => {
          const type = node.dataset.embed || "";
          const id = node.dataset.id || "";
          const item = map.get(`${type}:${id}`);
          const card = document.createElement("span");
          card.className = "embed-card";
          const badge = document.createElement("span");
          badge.className = "embed-kind";
          badge.textContent = type === "user" ? "用户" : type === "post" ? "帖子" : type === "article" ? "文章" : "角色";
          const title = document.createElement("strong");
          title.textContent = item?.name || item?.title || item?.nickname || "引用内容不可见";
          card.appendChild(badge);
          card.appendChild(title);
          if (item?.intro || item?.summary) {
            const desc = document.createElement("small");
            desc.textContent = String(item.intro || item.summary).slice(0, 80);
            card.appendChild(desc);
          }
          node.replaceChildren(card);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clean]);

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const node = (event.target as HTMLElement).closest("[data-embed]") as HTMLElement | null;
    if (!node) return;
    const type = node.dataset.embed;
    const id = node.dataset.id;
    if (!id) return;
    event.stopPropagation();
    if (type === "user") push("user", { id });
    else if (type === "post") push("post", { id });
    else if (type === "article") push("article", { id });
    else if (type === "character") push("character-detail", { id });
  };

  return <div ref={ref} className="rich-content" onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
}

export function PostCard({ post, onOpen }: { post: Post; onOpen?: () => void }) {
  const { push } = useNav();
  const summary = post.summary || stripHtml(post.content || "");
  return (
    <article className="post-card" onClick={() => (onOpen ? onOpen() : push("post", { id: post.id }))}>
      <div className="post-head">
        <Avatar src={post.user_avatar || post.author_avatar} name={post.user_name || post.author_name} size={34} />
        <div className="post-author">
          <div className="post-name">
            {post.user_name || post.author_name || "论坛用户"}
            {post.user_guild_name ? (
              <span className="pill" style={{ color: post.user_guild_theme_color || "var(--color-primary)" }}>
                {post.user_guild_name}
              </span>
            ) : null}
          </div>
          <div className="post-meta">
            {categoryLabel(post.category)} · {timeAgo(post.published_at || post.created_at)}
          </div>
        </div>
        <span className="cat-dot" style={{ background: categoryColor(post.category) }} />
      </div>
      <h3 className="post-title">{post.title}</h3>
      {summary ? <p className="post-summary">{textLimit(summary, 180)}</p> : null}
      {Array.isArray(post.images) && post.images.length > 0 ? (
        <div className="post-images">
          {post.images.slice(0, 3).map((src) => (
            <img key={src} src={avatarUrl(src)} alt="" />
          ))}
        </div>
      ) : null}
      <div className="post-foot">
        <span>♡ {post.likes ?? 0}</span>
        <span>💬 {post.comment_count ?? 0}</span>
        <span className="post-cat">#{categoryLabel(post.category)}</span>
      </div>
    </article>
  );
}

export function ToastHost() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  return <div className={`toast ${toast.kind === "error" ? "toast-error" : ""}`}>{toast.message}</div>;
}

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => {
      onClose();
      return true;
    });
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <strong>{title}</strong>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  children,
  confirmText = "确定",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => {
      onCancel();
      return true;
    });
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="sheet-mask" onClick={onCancel}>
      <div className="confirm" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <div className="confirm-body">{children}</div>
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
