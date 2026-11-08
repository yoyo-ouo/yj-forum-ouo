import React, { useEffect, useMemo, useRef } from "react";
import { registerBackHandler } from "../lib/back";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { avatarUrl, categoryColor, categoryLabel, contrastText, stripHtml, textLimit, timeAgo } from "../lib/format";
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

export function CategoryBadge({ category, className = "post-card-category" }: { category?: string; className?: string }) {
  const color = categoryColor(category);
  return (
    <span className={className} style={{ background: color, color: contrastText(color) }}>
      {categoryLabel(category)}
    </span>
  );
}

export function SpaceBadge({ name, color, className = "space-badge" }: { name?: string | null; color?: string | null; className?: string }) {
  if (name) {
    const bg = color || "var(--color-primary)";
    return (
      <span className={className} style={{ background: bg, color: contrastText(color || "#6A8C89") }} title={`会馆：${name}`}>
        <i className="fa fa-home" /> {name}
      </span>
    );
  }
  return (
    <span className={`${className} space-badge-public`.trim()} title="公共空间" style={{ background: "#3f5854", color: "#fff" }}>
      <i className="fa fa-globe" /> 公共空间
    </span>
  );
}

export function Avatar({ src, name, size = 36 }: { src?: string | null; name?: string; size?: number }) {
  const url = avatarUrl(src);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}>
      {url ? <img src={url} alt={name || ""} /> : <i className="fa fa-user" aria-hidden="true" />}
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

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "del", "code", "pre", "blockquote",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "a", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tr", "th", "td", "hr", "span", "div",
  ],
  ALLOWED_ATTR: ["href", "src", "alt", "title", "target", "rel", "class", "colspan", "rowspan", "data-embed", "data-id", "data-internal"],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ["style", "form", "input", "button", "select", "textarea", "dialog", "template", "iframe", "object", "embed", "link", "meta", "script"],
  FORBID_ATTR: ["style"],
};

let hooksInstalled = false;
function installPurifyHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node: any) => {
    if (node.tagName === "A") {
      const href = String(node.getAttribute("href") || "");
      if (href.startsWith("/")) {
        node.setAttribute("data-internal", "1");
        node.removeAttribute("target");
      } else if (href) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer nofollow");
      }
    }
    if (node.tagName === "IMG") {
      node.setAttribute("loading", "lazy");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
  });
}

export const RichContent = React.memo(function RichContent({ html, format }: { html?: string | null; format?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const { push } = useNav();
  const clean = useMemo(() => {
    const raw = format === "markdown" ? (marked.parse(html || "") as string) : html || "";
    installPurifyHooks();
    return DOMPurify.sanitize(raw, PURIFY_CONFIG as any);
  }, [html, format]);

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
    const internal = (event.target as HTMLElement).closest("a[data-internal]") as HTMLAnchorElement | null;
    if (internal) {
      const href = internal.getAttribute("href") || "";
      const match = href.match(/^\/(post|users?|article|character|huiguan)\/([^/?#]+)/);
      if (match) {
        event.preventDefault();
        const [, kind, id] = match;
        if (kind === "post") push("post", { id });
        else if (kind === "users" || kind === "user") push("user", { id });
        else if (kind === "article") push("article", { id });
        else if (kind === "character") push("character-detail", { id });
        else if (kind === "huiguan") push("guild", { slug: id });
        return;
      }
    }
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
});

export function PostCard({ post, onOpen }: { post: Post; onOpen?: () => void }) {
  const { push } = useNav();
  const rawSummary = post.summary || stripHtml(post.content || "");
  const summary = rawSummary.slice(0, 100);
  const author = post.user_name || post.author_name || "论坛用户";
  return (
    <article className="post-card" onClick={() => (onOpen ? onOpen() : push("post", { id: post.id }))}>
      <div className="post-card-left">
        <div className="post-card-avatar">
          <Avatar src={post.user_avatar || post.author_avatar} name={author} size={44} />
        </div>
      </div>
      <div className="post-card-body">
        <div className="post-card-header">
          <CategoryBadge category={post.category} />
          <SpaceBadge name={post.user_guild_name} color={post.user_guild_theme_color} />
          <span className="post-card-author">{author}</span>
          <span className="post-card-time">{timeAgo(post.published_at || post.created_at)}</span>
        </div>
        <h3 className="post-card-title">{post.title}</h3>
        {summary ? (
          <p className="post-card-summary">{summary}{rawSummary.length >= 100 ? "..." : ""}</p>
        ) : null}
        <div className="post-card-footer">
          <span className="post-card-stats"><i className="fa fa-eye" /> {post.views ?? 0}</span>
          <span className="post-card-stats"><i className="fa fa-thumbs-up" /> {post.likes ?? 0}</span>
          <span className="post-card-stats"><i className="fa fa-comment" /> {post.comment_count ?? 0}</span>
        </div>
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
