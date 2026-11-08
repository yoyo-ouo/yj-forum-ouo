import { mediaUrl } from "./native";

export const CATEGORY_LABELS: Record<string, string> = {
  general: "综合",
  talk: "闲聊",
  question: "求助",
  share: "分享",
  creative: "创作",
};

export const CATEGORY_COLORS: Record<string, string> = {
  general: "#6A8C89",
  talk: "#f59e0b",
  question: "#ef4444",
  share: "#10b981",
  creative: "#8b5cf6",
};

export function categoryLabel(category?: string): string {
  return CATEGORY_LABELS[category || ""] || category || "综合";
}

export function categoryColor(category?: string): string {
  return CATEGORY_COLORS[category || ""] || "#6A8C89";
}

export function timeAgo(input?: string | number | null): string {
  if (!input) return "";
  const date = typeof input === "number" ? new Date(input) : new Date(input);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff)) return "";
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return date.toLocaleDateString("zh-CN");
}

export function formatDate(input?: string | null): string {
  if (!input) return "";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function avatarUrl(path?: string | null): string {
  return mediaUrl(path);
}

export function stripHtml(html?: string | null): string {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function textLimit(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
