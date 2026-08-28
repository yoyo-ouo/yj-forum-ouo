"use client";

import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

/** 与 legacy _isExternalLink 一致：相对路径放行，同域 yjlt.top 放行，其余外部链接改写 */
function isExternalLink(href: string): boolean {
  if (!href) return false;
  if (href.charAt(0) === "/" || href.charAt(0) === "#" || href.charAt(0) === "?") return false;
  const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/([^/?#]+)/.exec(href);
  if (!m) return false;
  const host = m[2].toLowerCase();
  if (host === "yjlt.top" || host.endsWith(".yjlt.top")) return false;
  return true;
}

let hookAdded = false;
/** 在浏览器中注册一次链接改写 hook（幂等） */
function ensureHook() {
  if (hookAdded) return;
  if (typeof DOMPurify.sanitize !== "function") return; // Node/SSR 下不可用
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") || "";
      if (href.toLowerCase().startsWith("javascript:")) return;
      if (isExternalLink(href)) {
        node.setAttribute("href", "/GoTo?to=" + encodeURIComponent(href));
        node.setAttribute("rel", "nofollow noopener noreferrer");
        if (!node.getAttribute("target")) node.setAttribute("target", "_blank");
      }
    }
  });
  hookAdded = true;
}

/**
 * Markdown 渲染（原生 React 组件，替代 legacy 的 marked + _sanitizeHtml）。
 * - 与 legacy 一致：breaks:true, gfm:true
 * - DOMPurify 净化：移除 script/iframe 等危险标签与 on* 事件属性（等价 legacy _sanitizeHtml）
 * - 外部链接改写为 /GoTo?to=... 过渡页（等价 legacy 链接改写）
 * 注意：正文由客户端 API 加载，首次渲染 content 为空，因此 SSR 不会输出未净化 HTML。
 */
export default function Markdown({ content, className = "" }: { content?: string; className?: string }) {
  const html = useMemo(() => {
    if (!content) return "";
    let raw = "";
    try {
      raw = marked.parse(content, { breaks: true, gfm: true }) as string;
    } catch {
      return content;
    }
    // 浏览器环境净化；SSR/未初始化时原样返回（客户端渲染时再净化）
    if (typeof DOMPurify.sanitize !== "function") return raw;
    try {
      ensureHook();
      return DOMPurify.sanitize(raw, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style", "link", "meta"],
      });
    } catch {
      return raw;
    }
  }, [content]);

  return <div className={className || undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}


