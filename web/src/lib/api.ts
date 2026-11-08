import { requestApi } from "./native";
import type { CommentItem, Post, UpdateManifest, User } from "./types";

export class ApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, code: string | undefined, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T = any>(
  method: string,
  path: string,
  query?: Record<string, string | number | undefined>,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const normalizedQuery: Record<string, string> = {};
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") normalizedQuery[key] = String(value);
  });
  const res = await requestApi<T>({ method, path, query: normalizedQuery, body, timeoutMs });
  const data: any = res.data;
  if (!res.ok || data?.success === false) {
    const message =
      data?.message ||
      data?.error ||
      data?.msg ||
      (res.status === 401 ? "登录已过期，请重新登录" : res.status === 429 ? "操作太频繁，请稍后再试" : "请求失败");
    throw new ApiError(String(message), data?.code ? String(data.code) : undefined, res.status);
  }
  return data as T;
}

export interface FeedResponse {
  items: Post[];
  has_more: boolean;
  page: number;
  page_size: number;
  space?: string;
  guild?: any;
}

export interface PostsResponse {
  posts: Post[];
  has_more?: boolean;
  page: number;
  page_size: number;
}

export interface CommentsResponse {
  comments: CommentItem[];
  has_more?: boolean;
  page_size: number;
  next_cursor?: number | null;
}

export const api = {
  async me(): Promise<User | null> {
    const res = await requestApi<any>({ method: "GET", path: "/users/me" });
    if (res.status === 401) return null;
    if (!res.data?.success) return null;
    return res.data.user as User;
  },
  login(name: string, password: string, remember = true) {
    return request<{ id: number }>("POST", "/auth/login", undefined, { name, password, remember });
  },
  register(payload: { name: string; email: string; password: string; code: string }) {
    return request<{ id: number }>("POST", "/auth/register", undefined, payload);
  },
  registerCode(email: string) {
    return request("POST", "/auth/register/code", undefined, { email });
  },
  logout() {
    return request("POST", "/auth/logout", undefined, {});
  },
  siteConfig() {
    return request<{ data: any }>("GET", "/site/config");
  },
  dailyQuote() {
    return request<{ text: string; source?: string }>("GET", "/site/daily-quote");
  },
  easterEgg() {
    return request<any>("GET", "/easter-egg");
  },
  feed(params: { space?: string; guild_id?: string | number; category?: string; page?: number; page_size?: number }) {
    return request<FeedResponse>("GET", "/feed", params);
  },
  randomPosts() {
    return request<{ posts: Post[] }>("GET", "/posts/random");
  },
  posts(params: { page?: number; page_size?: number; category?: string }) {
    return request<PostsResponse>("GET", "/posts", params);
  },
  postDetail(id: number | string) {
    return request<{ post: Post; comments: CommentItem[]; liked: boolean; favorited: boolean }>(
      "GET",
      `/posts/${id}`,
      { include_comments: "0", track: "0" },
    );
  },
  comments(postId: number | string, beforeId?: number | string, limit = 50) {
    return request<CommentsResponse>("GET", `/posts/${postId}/comments`, { limit, before_id: beforeId });
  },
  createComment(postId: number | string, content: string, parentId?: string | number | null) {
    return request<{ comment: CommentItem }>("POST", `/posts/${postId}/comments`, undefined, {
      content,
      parent_id: parentId || undefined,
    });
  },
  likePost(id: number | string) {
    return request<{ liked: boolean; likes: number }>("POST", `/posts/${id}/like`, undefined, {});
  },
  favoritePost(id: number | string) {
    return request<{ favorited: boolean }>("POST", `/posts/${id}/favorite`, undefined, {});
  },
  deletePost(id: number | string) {
    return request("POST", `/posts/${id}/delete`, undefined, {});
  },
  createPost(payload: { title: string; content: string; category?: string; guild_uuid?: string; published_at?: string }) {
    return request<{ id: number }>("POST", "/posts", undefined, payload);
  },
  likeComment(id: number | string) {
    return request<{ liked: boolean; likes: number }>("POST", `/comments/${id}/like`, undefined, {});
  },
  deleteComment(id: number | string) {
    return request("DELETE", `/comments/${id}`, undefined, {});
  },
  user(id: number | string) {
    return request<any>("GET", `/users/${id}`);
  },
  userPosts(id: number | string, page = 1, pageSize = 20) {
    return request<PostsResponse>("GET", `/users/${id}/posts`, { page, page_size: pageSize });
  },
  userComments(id: number | string, page = 1, pageSize = 20) {
    return request<any>("GET", `/users/${id}/comments`, { page, page_size: pageSize });
  },
  userFavorites(id: number | string, page = 1, pageSize = 20) {
    return request<PostsResponse>("GET", `/users/${id}/favorites`, { page, page_size: pageSize });
  },
  follow(id: number | string) {
    return request<{ following: boolean }>("POST", `/users/${id}/follow`, undefined, {});
  },
  following(id: number | string, page = 1, pageSize = 20) {
    return request<any>("GET", `/users/${id}/following`, { page, page_size: pageSize });
  },
  followers(id: number | string, page = 1, pageSize = 20) {
    return request<any>("GET", `/users/${id}/followers`, { page, page_size: pageSize });
  },
  search(keyword: string, type: "posts" | "users" | "both" = "both", page = 1, pageSize = 20) {
    return request<any>("GET", "/search", { k: keyword, type, page, page_size: pageSize });
  },
  searchArticles(keyword: string, page = 1, pageSize = 20) {
    return request<any>("GET", "/articles/search", { k: keyword, page, page_size: pageSize });
  },
  guilds() {
    return request<{ guilds: any[] }>("GET", "/guilds");
  },
  guild(slug: string) {
    return request<any>("GET", `/guilds/${slug}`);
  },
  guildFeed(slug: string, page = 1, pageSize = 20, category?: string) {
    return request<FeedResponse>("GET", `/guilds/${slug}/feed`, { page, page_size: pageSize, category });
  },
  guildMembers(slug: string, page = 1, pageSize = 24) {
    return request<any>("GET", `/guilds/${slug}/members`, { page, page_size: pageSize });
  },
  guildLeader(slug: string) {
    return request<any>("GET", `/guilds/${slug}/leader`);
  },
  guildIntro(slug: string) {
    return request<any>("GET", `/guilds/${slug}/intro`);
  },
  article(id: number | string) {
    return request<any>("GET", `/articles/${id}`);
  },
  worldMessages(params: { before_id?: number; after_id?: number; limit?: number }) {
    return request<any>("GET", "/world/messages", params);
  },
  sendWorld(contentHtml: string, parentId?: number) {
    return request("POST", "/world/messages", undefined, { content_html: contentHtml, parent_id: parentId });
  },
  messagesSummary() {
    return request<{ likes: number; comments: number; system: number; chat: number }>("GET", "/messages/summary");
  },
  messagesAll(cursor?: string) {
    return request<any>("GET", "/messages/all", { cursor });
  },
  messagesCategory(category: "likes" | "comments" | "system", cursor?: string) {
    return request<any>("GET", `/messages/${category}`, { cursor });
  },
  messagesChat(cursor?: string) {
    return request<any>("GET", "/messages/chat", { cursor });
  },
  sendChat(contentHtml: string) {
    return request("POST", "/messages/chat", undefined, { content_html: contentHtml });
  },
  markRead(category: string, lastReadAt: string) {
    return request("POST", "/messages/read", undefined, { category, last_read_at: lastReadAt });
  },
  signIn() {
    return request<any>("POST", "/users/me/sign-in", undefined, {});
  },
  updateMe(payload: Record<string, unknown>) {
    return request<any>("PATCH", "/users/me", undefined, payload);
  },
  embeds(params: { users?: string[]; posts?: string[]; articles?: string[]; characters?: string[] }) {
    return request<any>("GET", "/embeds", {
      users: params.users?.filter(Boolean).join(","),
      posts: params.posts?.filter(Boolean).join(","),
      articles: params.articles?.filter(Boolean).join(","),
      characters: params.characters?.filter(Boolean).join(","),
    });
  },
  characterSheetsMine() {
    return request<any>("GET", "/character-sheets/mine");
  },
  characterSheet(id: number | string) {
    return request<any>("GET", `/character-sheets/${id}`);
  },
  characterSheetsUser(userId: number | string) {
    return request<any>("GET", `/character-sheets/user/${userId}`);
  },
  guides() {
    return request<any>("GET", "/guides");
  },
  guide(id: number | string) {
    return request<any>("GET", `/guides/${id}`);
  },
  changelogs(page = 1, pageSize = 20) {
    return request<any>("GET", "/changelogs", { page, page_size: pageSize });
  },
  changelog(id: number | string) {
    return request<any>("GET", `/changelogs/${id}`);
  },
  bugReports(page = 1, pageSize = 20) {
    return request<any>("GET", "/reports/bug", { page, page_size: pageSize });
  },
  bugReport(id: number | string) {
    return request<any>("GET", `/reports/bug/${id}`);
  },
  createBugReport(payload: Record<string, unknown>) {
    return request<any>("POST", "/reports/bug", undefined, payload);
  },
  downloadsCheck(version: string) {
    return request<UpdateManifest>("GET", "/downloads/check", { platform: "android", version });
  },
  downloadsReleases(page = 1, pageSize = 20) {
    return request<any>("GET", "/downloads/releases", { platform: "android", page, page_size: pageSize });
  },
};
