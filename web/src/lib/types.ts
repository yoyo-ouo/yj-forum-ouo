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
  apiBaseUrl: string;
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
