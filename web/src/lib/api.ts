import { requestApi, clearCaptcha, getCaptchaStatus, uploadAvatar as nativeUploadAvatar, uploadAvatarData as nativeUploadAvatarData } from "./native";
import { bus } from "./bus";
import type {
  CaptchaErrorCode,
  CharacterPayload,
  CharacterSheet,
  CommentItem,
  FollowingResponse,
  LikeMessagesResponse,
  Post,
  PostDraft,
  PostDraftItem,
  PostDraftPayload,
  ProfilePayload,
  UpdateManifest,
  User,
  WorldMessagesResponse,
  WorldParent,
} from "./types";

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

/** 服务端错误文案：data.message / data.error / data.msg 的兜底优先级与旧实现一致。 */
function responseMessage(data: any, status: number): string {
  return (
    data?.message ||
    data?.error ||
    data?.msg ||
    (status === 401 ? "登录已过期，请重新登录" : status === 429 ? "操作太频繁，请稍后再试" : "请求失败")
  );
}

function toApiError(res: { status: number; data?: any }): ApiError {
  const data: any = res.data;
  return new ApiError(
    String(responseMessage(data, res.status)),
    data?.code ? String(data.code) : undefined,
    res.status,
  );
}

/** 合法分类白名单：原生壳/服务端下发未知字符串时退化为 REJECTED，不让 UI 拿不到文案。 */
const CAPTCHA_ERROR_CODES: CaptchaErrorCode[] = [
  "DISABLED",
  "APP_DISABLED",
  "MISSING_SECRET",
  "SECRET_MISMATCH",
  "RATE_LIMITED",
  "NETWORK",
  "REJECTED",
];

function isCaptchaErrorCode(value: unknown): value is CaptchaErrorCode {
  return typeof value === "string" && CAPTCHA_ERROR_CODES.includes(value as CaptchaErrorCode);
}

/**
 * 验证失败归类：服务端只回 CAPTCHA_REQUIRED，具体原因靠 /captcha/config 与客户端配置诊断。
 * 结果经事件总线交给 store.captchaError，由 CaptchaErrorSheet 展示。
 */
async function reportCaptchaError(reason: CaptchaErrorCode) {
  let code = reason;
  if (reason === "REJECTED") {
    const status = await getCaptchaStatus().catch(() => null);
    if (!status) code = "NETWORK";
    else if (isCaptchaErrorCode(status.error)) code = status.error;
    else if (!status.enabled) code = "DISABLED";
    else if (!status.app_enabled) code = "APP_DISABLED";
    else if (status.source === "native" && status.client_secret_configured === false) code = "MISSING_SECRET";
    else if (status.source === "native") code = "SECRET_MISMATCH";
    else code = "REJECTED";
  }
  bus.emit("captchaError", code);
}

async function request<T = any>(
  method: string,
  path: string,
  query?: Record<string, string | number | undefined>,
  body?: unknown,
  timeoutMs?: number,
  captchaRetried = false,
): Promise<T> {
  const normalizedQuery: Record<string, string> = {};
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") normalizedQuery[key] = String(value);
  });
  const res = await requestApi<T>({ method, path, query: normalizedQuery, body, timeoutMs });
  const data: any = res.data;
  if (!res.ok || data?.success === false) {
    const message = String(responseMessage(data, res.status));
    // 400 CAPTCHA_REQUIRED：先清本地验证凭证再重试一次（凭证过期/换 IP 后旧 grant 会失效）
    if (!captchaRetried && res.status === 400 && message === "CAPTCHA_REQUIRED") {
      await clearCaptcha().catch(() => undefined);
      return request<T>(method, path, query, body, timeoutMs, true);
    }
    if (message === "CAPTCHA_REQUIRED") void reportCaptchaError("REJECTED");
    else if (message === "CAPTCHA_UNAVAILABLE") void reportCaptchaError("NETWORK");
    else if (res.status === 429 && message.includes("验证")) void reportCaptchaError("RATE_LIMITED");
    // 426：版本过低。原生壳自己会 notifyListeners("versionTooLow")，web 模式靠这个事件补齐
    if (res.status === 426 || data?.code === "VERSION_TOO_LOW") bus.emit("versionTooLow", { status: res.status || 426 });
    throw new ApiError(message, data?.code ? String(data.code) : undefined, res.status);
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
  /** 举报帖子：reason 取 spam/abuse/porn/illegal/infringement/other，detail ≤ 500 字 */
  reportPost(id: number | string, reason: string, detail = "") {
    return request<{ success: boolean }>("POST", `/posts/${id}/report`, undefined, { reason, detail });
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
  /** 共同关注（匿名 / 看自己时服务端返回空列表） */
  mutual(id: number | string, page = 1, pageSize = 20) {
    return request<FollowingResponse>("GET", `/users/${id}/mutual`, { page, page_size: pageSize });
  },
  /** 谁赞了我（仅本人；cursor 分页） */
  likesMe(cursor?: string, limit = 20) {
    return request<LikeMessagesResponse>("GET", "/users/me/likes", { cursor, limit });
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
    return request<WorldMessagesResponse>("GET", "/world/messages", params);
  },
  /** 发布世界消息；parentId 为引用的原消息（响应带 parent 摘要，可直接插到本地列表） */
  sendWorld(contentHtml: string, parentId?: number) {
    return request<{ id: number; parent?: WorldParent | null }>("POST", "/world/messages", undefined, { content_html: contentHtml, parent_id: parentId });
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
  /** 资料修改（服务端白名单字段：name/gender/age/intro/avatar/password）
   *  服务端字段名是 `Name`（大写 N），这里把 name 拍平成 `Name` 提交。 */
  updateProfile(payload: ProfilePayload) {
    const { name, ...rest } = payload;
    const body = name === undefined ? rest : { ...rest, Name: name };
    return request<{ success: boolean }>("PATCH", "/users/me", undefined, body);
  },
  /** 头像上传：path 为相册/相机返回的本地路径或 data URL */
  async uploadAvatar(path: string): Promise<{ avatar: string }> {
    const res = await nativeUploadAvatar(path);
    if (!res.ok || (res.data as any)?.success === false) throw toApiError(res);
    return res.data as unknown as { avatar: string };
  },
  async uploadAvatarData(dataUrl: string): Promise<{ avatar: string }> {
    const res = await nativeUploadAvatarData(dataUrl);
    if (!res.ok || (res.data as any)?.success === false) throw toApiError(res);
    return res.data as unknown as { avatar: string };
  },
  /* ---- 邮箱验证 ---- */
  verifyEmail() {
    return request<{ message?: string }>("POST", "/users/me/verify-email", undefined, {});
  },
  confirmVerifyEmail(code: string) {
    return request<{ message?: string }>("POST", "/users/me/verify-email/confirm", undefined, { code });
  },
  /* ---- 邮箱换绑（两步）：① 当前邮箱 ② 新邮箱 ---- */
  emailChangeCode() {
    return request<{ message?: string }>("POST", "/users/me/email-change/code", undefined, {});
  },
  verifyOldEmail(code: string) {
    return request<{ message?: string }>("POST", "/users/me/email-change/verify-old", undefined, { code });
  },
  emailChangeNewCode(newEmail: string) {
    return request<{ message?: string }>("POST", "/users/me/email-change/new-code", undefined, { newEmail });
  },
  confirmEmailChange(code: string) {
    return request<{ message?: string }>("POST", "/users/me/email-change/confirm", undefined, { code });
  },
  /* ---- 注销账号：mode=purge 彻底删除 / anonymize 匿名化保留 ---- */
  deleteAccount(mode: "purge" | "anonymize", password: string, confirmName: string) {
    return request<{ message?: string }>("POST", "/users/me/delete", undefined, { mode, password, confirmName });
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

  /* ---------------- 帖子草稿（全部需登录，服务端按 user_id 隔离） ---------------- */

  listDrafts(limit = 50) {
    return request<{ drafts: PostDraftItem[] }>("GET", "/posts/drafts", { limit });
  },
  createDraft() {
    return request<{ id: string }>("POST", "/posts/drafts", undefined, {});
  },
  getDraft(id: string) {
    return request<{ draft: PostDraft }>("GET", `/posts/drafts/${id}`);
  },
  saveDraft(id: string, payload: PostDraftPayload) {
    return request<{ saved_at: string }>("PUT", `/posts/drafts/${id}`, undefined, payload);
  },
  publishDraft(id: string, payload: PostDraftPayload) {
    return request<{ id: string }>("POST", `/posts/drafts/${id}/publish`, undefined, payload);
  },
  deleteDraft(id: string) {
    return request<{ success: boolean }>("DELETE", `/posts/drafts/${id}`);
  },

  /* ---------------- 角色设定 ---------------- */

  createCharacter() {
    return request<{ item: CharacterSheet }>("POST", "/character-sheets", undefined, {});
  },
  saveCharacterDraft(id: string, payload: CharacterPayload) {
    return request<{ saved_at: string }>("PUT", `/character-sheets/${id}/draft`, undefined, payload);
  },
  publishCharacter(id: string, payload: CharacterPayload) {
    return request<{ item: CharacterSheet }>("POST", `/character-sheets/${id}/publish`, undefined, payload);
  },
  deleteCharacterDraft(id: string) {
    return request<{ success: boolean }>("DELETE", `/character-sheets/${id}/draft`);
  },
  deleteCharacter(id: string) {
    return request<{ success: boolean }>("DELETE", `/character-sheets/${id}`);
  },
  likeCharacter(id: string) {
    return request<{ liked: boolean; likes: number }>("POST", `/character-sheets/${id}/like`, undefined, {});
  },
  /** 角色选择器搜索：空关键词返回最新公开设定 */
  searchCharacters(k = "", page = 1, pageSize = 10) {
    return request<{ items: CharacterSheet[]; has_more: boolean; page: number }>("GET", "/character-sheets/search", {
      k,
      page,
      page_size: pageSize,
    });
  },
};
