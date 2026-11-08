export interface ApiResponse<T = any> {
  status: number;
  ok: boolean;
  data?: T;
  text?: string;
}

export interface AppInfo {
  versionName: string;
  versionCode: number;
  packageName: string;
  /** 当前壳实际使用的 API 基址（新壳直接下发 apiBase） */
  apiBase: string;
  /** 旧壳字段：与 apiBase 同义，getAppInfo 会归一后保留 */
  apiBaseUrl?: string;
  altchaConfigured: boolean;
}

export interface StartupState {
  hasSession: boolean;
  theme?: string | null;
  yearMode?: string | null;
  privacyAgreedVersion?: string | null;
  lastName?: string | null;
}

export type Theme = "day" | "night" | "auto";

/* ---------------- 世界频道 ---------------- */

/** 世界频道被引用的原消息（服务端 parent 字段：发送时的昵称/头像快照 + 正文摘要）。 */
export interface WorldParent {
  id: number | string;
  sender_name?: string;
  sender_avatar?: string;
  content?: string;
  content_format?: string;
  created_at?: string;
}

/** 世界频道消息。服务端字段为 sender_*，同时兼容旧契约的 user_* 命名。 */
export interface WorldMessage {
  id: number | string;
  sender_id?: string;
  sender_name?: string;
  sender_avatar?: string;
  user_id?: string;
  user_name?: string;
  user_avatar?: string;
  content?: string;
  content_format?: string;
  parent_id?: number | string | null;
  /** 被引用消息摘要；无引用或父消息已删除时为 null（服务端随列表/发送响应下发） */
  parent?: WorldParent | null;
  guild_id?: string;
  guild_name?: string;
  is_leader?: boolean;
  is_admin?: boolean;
  admin_id?: string;
  created_at?: string;
}

/** GET /world/messages */
export interface WorldMessagesResponse {
  items: WorldMessage[];
  has_more: boolean;
  next_before_id?: number | null;
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
  gender?: number | string;
  age?: string;
  intro?: string;
  spirit?: number;
  last_sign_in?: string;
  prefix?: string;
  is_banned?: number | boolean;
  email_verified?: number | boolean;
  created_at?: string;
  deleted?: boolean;
}

export interface Post {
  id: string;
  user_id: string;
  title: string;
  summary?: string;
  content?: string;
  content_format?: "html" | "markdown" | string;
  category?: string;
  likes?: number;
  views?: number;
  comment_count?: number;
  created_at?: string;
  published_at?: string;
  user_name?: string;
  user_avatar?: string;
  author_name?: string;
  author_avatar?: string;
  user_guild_name?: string;
  user_guild_theme_color?: string;
  guild_name?: string;
  guild_theme_color?: string;
  user_is_leader?: boolean;
  liked_by_me?: boolean;
  favorited_by_me?: boolean;
  images?: string[];
  status?: number;
}

export interface CommentItem {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  content_format?: string;
  parent_id?: string | null;
  likes?: number;
  liked_by_me?: boolean;
  created_at?: string;
  user_name?: string;
  user_avatar?: string;
  user_guild_name?: string;
  user_guild_theme_color?: string;
  author_name?: string;
  author_avatar?: string;
}

export interface UpdateRelease {
  version: string;
  url: string;
  filename: string;
  size?: number;
  sha256?: string;
  notes?: string[];
  notes_markdown?: string;
  mandatory?: boolean;
  channel?: string;
  date?: string;
}

export interface UpdateManifest {
  available: boolean;
  current?: string;
  latest?: string;
  mandatory?: boolean;
  min_version?: string;
  release?: UpdateRelease | null;
  source?: string;
}

export interface ToastState {
  message: string;
  kind: "info" | "error";
}

/* ---------------- 关注 / 点赞 ---------------- */

/** 关注/粉丝/共同关注列表项（GET /users/:id/{following,followers,mutual}）。 */
export interface FollowUser {
  id: string;
  name: string;
  avatar?: string;
  prefix?: string;
  intro?: string;
  is_self?: boolean;
  is_following?: boolean;
  /** 共同关注：viewer 也关注了该用户（仅部分列表下发） */
  is_mutual?: boolean;
}

export interface FollowingResponse {
  users: FollowUser[];
  page: number;
  page_size: number;
  has_more?: boolean;
}

/** 「谁赞了我」条目（GET /users/me/likes，仅本人可见）。 */
export interface LikeActor {
  id: string;
  name: string;
  avatar?: string;
}

export type LikeTargetType = "post" | "comment" | "character";

export interface LikeMessage {
  id: string;
  actor: LikeActor;
  target_type: LikeTargetType;
  target_id?: string;
  post_id?: string;
  post_title?: string;
  comment_id?: string;
  comment_excerpt?: string;
  /** 设定名（target_type=character 时有效） */
  target_title?: string;
  created_at?: string;
}

export interface LikeMessagesResponse {
  items: LikeMessage[];
  has_more: boolean;
  next_cursor?: string | null;
}

/* ---------------- 资料 / 账号 ---------------- */

/** PATCH /users/me 可改字段（服务端白名单；灵力值与签到日期不可改）。 */
export interface ProfilePayload {
  name?: string;
  gender?: number;
  age?: string;
  intro?: string;
  avatar?: string;
  password?: string;
  current_password?: string;
}

/** 注销账号的两种模式：彻底删除 / 匿名化保留内容。 */
export type AccountDeleteMode = "purge" | "anonymize";

/** 邮箱换绑流程阶段（前端页面状态机）。 */
export type EmailChangeStage = "idle" | "old-sent" | "old-verified" | "new-sent" | "done";

/* ---------------- 帖子草稿 ---------------- */

/** 帖子草稿列表项（仅本人可读；不含正文）。 */
export interface PostDraftItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  guild_id?: number | null;
  guild_uuid?: string;
  guild_name?: string;
  guild_theme_color?: string;
  /** 草稿里暂存的定时发布时间（RFC3339；未开启时缺省） */
  scheduled_at?: string;
  created_at?: string;
  updated_at?: string;
}

/** 帖子草稿详情（作者本人；含正文）。 */
export interface PostDraft extends PostDraftItem {
  content: string;
  content_format?: string;
  /** 编辑器会话级发布幂等标识，旧草稿可能为空 */
  publish_token?: string;
}

/** 草稿保存 / 发布负载（guild_uuid 为空 = 公共空间）。 */
export interface PostDraftPayload {
  title: string;
  content: string;
  category: string;
  guild_uuid?: string;
  scheduled_at?: string;
  publish_token?: string;
}

/* ---------------- 角色设定 ---------------- */

/** 六大能力系（与后端白名单一致）。 */
export type CharacterCategory =
  | "御灵系"
  | "生灵系"
  | "锁御系"
  | "造物系"
  | "心灵系"
  | "空间系";

export interface CharacterAbility {
  category: CharacterCategory | string;
  detail: string;
}

/** 设定语录（已公开内容）。 */
export interface CharacterQuote {
  id: number;
  content: string;
  is_active: boolean;
}

/** 语录输入项（编辑期）。 */
export interface CharacterQuoteInput {
  content: string;
}

/** 设定所属会馆（mode: none / existing / custom）。 */
export interface CharacterGuildRef {
  mode: "none" | "existing" | "custom";
  guild_id: number;
  custom_name: string;
}

/** 编辑期内容：草稿 JSONB 与发布请求共用同一结构。 */
export interface CharacterPayload {
  name: string;
  alias: string;
  title: string;
  gender: number;
  age: string;
  build: string;
  species: string;
  identity: string;
  description_html: string;
  avatar_media_id: string;
  image_media_ids: string[];
  guild: CharacterGuildRef;
  abilities: CharacterAbility[];
  quotes: CharacterQuoteInput[];
  quotes_visible: boolean;
}

/** 设定详情（status: 0 草稿 / 1 已公开 / 2 管理员下架）。 */
export interface CharacterSheet {
  id: string;
  user_id: string;
  status: number;
  version: number;
  name: string;
  alias: string;
  title: string;
  gender: number;
  age: string;
  build: string;
  species: string;
  identity: string;
  description_html: string;
  avatar_media_id: string;
  avatar?: string;
  guild_id?: number | null;
  guild_uuid?: string;
  guild_name?: string;
  guild_theme_color?: string;
  guild_custom_name?: string;
  quotes_visible: boolean;
  like_count?: number;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  abilities?: CharacterAbility[];
  images?: string[];
  quotes?: CharacterQuote[];
  owner_name?: string;
  owner_avatar?: string;
  owner_prefix?: string;
  liked?: boolean;
  mine?: boolean;
  has_draft?: boolean;
  draft_updated_at?: string | null;
  draft?: CharacterPayload | null;
}

/* ---------------- 人机验证 ---------------- */

/** 客户端可见的验证失败分类：决定 CaptchaErrorSheet 的文案与按钮。 */
export type CaptchaErrorCode =
  | "DISABLED"
  | "APP_DISABLED"
  | "MISSING_SECRET"
  | "SECRET_MISMATCH"
  | "RATE_LIMITED"
  | "NETWORK"
  | "REJECTED";

/** GET /captcha/config + 客户端配置合并后的状态。 */
export interface CaptchaStatus {
  /** 服务端是否开启人机验证 */
  enabled: boolean;
  /** 服务端 APP 专用零 PoW 通道是否开启 */
  app_enabled: boolean;
  algorithm?: string;
  cost?: number;
  /** 原生壳已诊断出的失败分类（如 MISSING_SECRET / SECRET_MISMATCH） */
  error?: CaptchaErrorCode | null;
  /** 客户端是否内置 APP 专用密钥（原生壳 BuildConfig.ALTCHA_APP_SECRET 非空） */
  client_secret_configured?: boolean;
  source?: "native" | "web";
}
