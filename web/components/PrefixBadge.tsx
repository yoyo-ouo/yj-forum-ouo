"use client";

import { prefixBadgeColor, prefixBadgeFor } from "@/lib/constants";

/** 用户 ID 前缀徽章（HG/YJ 三角 SVG），与 legacy getUserPrefixBadge 一致 */
export function InlinePrefixBadge({ userId }: { userId?: string | null }) {
  const color = prefixBadgeColor(userId);
  if (!color) return null;
  return (
    <span className="prefix-badge-inline" style={{ display: "inline-flex", alignItems: "center", marginLeft: 4 }}>
      <svg width="16" height="16" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
        <circle cx="11" cy="11" r="11" fill={color} />
        <path d="M11 15L6 7H8L11 11L14 7H16L11 15Z" fill="white" />
      </svg>
    </span>
  );
}

/** 资料卡前缀徽章（user.prefix 字段），带文字 */
export function ProfilePrefixBadge({ prefix }: { prefix?: string }) {
  const badge = prefixBadgeFor(prefix);
  if (!badge) return null;
  return (
    <div className="prefix-badge" style={{ background: badge.color }}>
      <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>{badge.text}</span>
    </div>
  );
}
