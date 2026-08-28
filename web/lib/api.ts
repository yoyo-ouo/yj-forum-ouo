// API 客户端层：统一 fetch + 类型 + 错误处理
"use client";

export type ApiError = { message: string; status: number };

export class ApiException extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  email?: string;
  gender?: number;
  age?: string;
  intro?: string;
  vip?: string;
  prefix?: string;
  email_verified?: number;
  created_at?: string;
}

export interface Post {
  id: string;
  user_id: string;
  title: string;
  content?: string;
  summary?: string;
  category: string;
  likes: number;
  views: number;
  comment_count?: number;
  status?: number;
  created_at?: string;
  user_name: string;
  user_avatar: string;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  parent_id?: string | null;
  likes: number;
  created_at?: string;
  user_name: string;
  user_avatar: string;
}

// 评论列表项：带所属帖子标题（个人中心评论列表用）
export interface ReplyItem extends Comment {
  post_title?: string;
}

export interface WorldMessage {
  id: number;
  sender_id: string;
  sender_name: string;
  sender_avatar?: string;
  content: string;
  parent_id?: number | null;
  created_at?: string;
}

export interface UserBrief {
  id: string;
  name: string;
  avatar: string;
  vip?: string;
  prefix?: string;
  intro?: string;
  is_self?: boolean;
  is_following?: boolean;
}

export interface SearchResult {
  keyword: string;
  page?: number;
  page_size?: number;
  posts?: Post[];
  posts_total?: number;
  posts_has_more?: boolean;
  users?: UserBrief[];
  users_total?: number;
  users_has_more?: boolean;
}

const API_BASE = "/api/v1";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = API_BASE + path;
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.success === false)) {
    throw new ApiException(res.status, (data as ApiResponse).message || `请求失败 (${res.status})`);
  }
  return data as T;
}

// ---- 认证 ----
export const authApi = {
  login: (name: string, password: string, remember = true) =>
    request<{ id: string }>("/auth/login", { method: "POST", body: JSON.stringify({ name, password, remember }) }),
  logout: () => request<{ success: boolean }>("/auth/logout", { method: "POST" }),
  register: (name: string, email: string, password: string, code: string) =>
    request<{ id: string }>("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password, code }) }),
  sendRegisterCode: (email: string) =>
    request<{ message: string }>("/auth/register/code", { method: "POST", body: JSON.stringify({ email }) }),
  sendResetCode: (email: string) =>
    request<{ message: string }>("/auth/password/reset/code", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (email: string, code: string, password: string) =>
    request<{ message: string }>("/auth/password/reset", { method: "POST", body: JSON.stringify({ email, code, password }) }),
};

// ---- 用户 ----
export const userApi = {
  me: () => request<{ user?: User }>("/users/me"),
  profile: (id: string) =>
    request<{ user: User; stats?: any; follow_stats?: any; is_following?: boolean; is_self?: boolean }>(`/users/${id}`),
  posts: (id: string, page = 1, pageSize = 20) =>
    request<{ posts: Post[]; page: number; page_size: number }>(`/users/${id}/posts?page=${page}&page_size=${pageSize}`),
  favorites: (id: string, page = 1, pageSize = 20) =>
    request<{ posts: Post[] }>(`/users/${id}/favorites?page=${page}&page_size=${pageSize}`),
  follow: (id: string) => request<{ following: boolean }>(`/users/${id}/follow`, { method: "POST" }),
  following: (id: string, page = 1, pageSize = 20) =>
    request<{ users: UserBrief[] }>(`/users/${id}/following?page=${page}&page_size=${pageSize}`),
  followers: (id: string, page = 1, pageSize = 20) =>
    request<{ users: UserBrief[] }>(`/users/${id}/followers?page=${page}&page_size=${pageSize}`),
  comments: (id: string, page = 1, pageSize = 20) =>
    request<{ comments: ReplyItem[]; total: number }>(`/users/${id}/comments?page=${page}&page_size=${pageSize}`),
  updateMe: (data: Record<string, unknown>) =>
    request<{ success: boolean }>("/users/me", { method: "PATCH", body: JSON.stringify(data) }),
  replies: (page = 1, pageSize = 50) =>
    request<{ replies: Comment[]; total: number }>(`/users/me/replies?page=${page}&page_size=${pageSize}`),
  verifyEmail: () => request<{ message: string }>("/users/me/verify-email", { method: "POST" }),
  verifyEmailConfirm: (code: string) =>
    request<{ message: string }>("/users/me/verify-email/confirm", { method: "POST", body: JSON.stringify({ code }) }),
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("avatar", file);
    return request<{ avatar: string }>("/users/me/avatar", { method: "POST", body: fd });
  },
};

// ---- 帖子 ----
export const postApi = {
  list: (page = 1, pageSize = 20, category = "") =>
    request<{ posts: Post[]; page: number; page_size: number }>(`/posts?page=${page}&page_size=${pageSize}${category ? `&category=${encodeURIComponent(category)}` : ""}`),
  random: () => request<{ posts: Post[] }>("/posts/random"),
  detail: (id: string) =>
    request<{ post: Post; comments: Comment[]; liked: boolean; favorited: boolean }>(`/posts/${id}`),
  create: (title: string, content: string, category: string) =>
    request<{ id: string }>("/posts", { method: "POST", body: JSON.stringify({ title, content, category }) }),
  like: (id: string) => request<{ liked: boolean; likes: number }>(`/posts/${id}/like`, { method: "POST" }),
  favorite: (id: string) => request<{ favorited: boolean }>(`/posts/${id}/favorite`, { method: "POST" }),
  remove: (id: string) => request<{ success: boolean }>(`/posts/${id}/delete`, { method: "POST" }),
  report: (id: string, reason: string, detail = "") =>
    request<{ success: boolean }>(`/posts/${id}/report`, { method: "POST", body: JSON.stringify({ reason, detail }) }),
  comments: (id: string, page = 1, pageSize = 50) =>
    request<{ comments: Comment[] }>(`/posts/${id}/comments?page=${page}&page_size=${pageSize}`),
  createComment: (id: string, content: string, parentId?: string) =>
    request<{ comment: Comment }>(`/posts/${id}/comments`, { method: "POST", body: JSON.stringify({ content, parent_id: parentId || null }) }),
  deleteComment: (id: string) => request<{ success: boolean }>(`/comments/${id}`, { method: "DELETE" }),
};

// ---- 世界频道 ----
export const worldApi = {
  messages: () => request<WorldMessage[]>("/world/messages"),
  send: (content: string, parentId?: number) =>
    request<{ success: boolean }>("/world/messages", { method: "POST", body: JSON.stringify({ content, parent_id: parentId ?? null }) }),
};

// ---- 搜索/杂项 ----
export const miscApi = {
  search: (k: string, type = "both", page = 1, pageSize = 20) =>
    request<SearchResult>(`/search?k=${encodeURIComponent(k)}&type=${type}&page=${page}&page_size=${pageSize}`),
  reportBug: (data: { title: string; detail: string; steps?: string; contact?: string; page_url?: string }) =>
    request<{ id: number }>("/reports/bug", { method: "POST", body: JSON.stringify(data) }),
  easterEgg: () => request<{ ID: string; Name: string; Text: string }>("/easter-egg"),
  huiGuan: () => request<{ list: unknown }>("/hui-guan"),
};

export { request };
