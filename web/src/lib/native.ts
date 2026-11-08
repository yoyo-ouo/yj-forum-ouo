import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { ApiResponse, AppInfo, CaptchaStatus, StartupState, UpdateManifest } from "./types";

const WEB_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "http://127.0.0.1:8090";
/** 原生壳未下发 apiBase 时的历史默认站（旧安装包） */
const NATIVE_FALLBACK_API_BASE = "https://www.yjlt.top";

/**
 * 原生壳下发的 API 基址。mediaUrl() 优先用它，避免 debug 包把图片引到生产域名：
 * 原生请求走 OkHttp（debug 指向本地/测试服务），而图片若写死生产域名会跨域且与登录态无关。
 */
let nativeApiBase: string | null = null;

/** getAppInfo 结果缓存：验证码状态诊断需要 altchaConfigured，不必每次重启原生桥。 */
let cachedAppInfo: AppInfo | null = null;

export function setNativeApiBase(base?: string | null) {
  nativeApiBase = base ? base.trim().replace(/\/$/, "") || null : null;
}

export interface ForumApiPlugin {
  request(o: {
    method: string;
    path: string;
    query?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  }): Promise<ApiResponse>;
  uploadImage(o: { path: string; scene?: string }): Promise<ApiResponse>;
  captchaConfig(): Promise<Record<string, unknown>>;
  /** 清掉本地缓存的验证凭证（下次请求重新向服务端换取） */
  clearCaptcha(): Promise<{ success: boolean }>;
  /** 验证通道状态（服务端开关 + 客户端密钥是否内置） */
  getCaptchaStatus(): Promise<CaptchaStatus>;
  /** 头像上传（multipart 字段名 avatar，成功后服务端已回写用户资料） */
  uploadAvatar(o: { path: string }): Promise<ApiResponse>;
  /** 裁剪后的头像 data URL 直接上传（原生解析 base64 后打 /users/me/avatar） */
  uploadAvatarData(o: { dataUrl: string }): Promise<ApiResponse>;
  /** 裁剪后的 data URL 直接上传（原生解析 base64 后打 /media/images） */
  uploadImageData(o: { dataUrl: string; scene?: string }): Promise<ApiResponse>;
  getAppInfo(): Promise<AppInfo>;
  getStartupState(): Promise<StartupState>;
  saveSettings(o: Partial<{ theme: string; yearMode: string; privacyAgreedVersion: string; lastName: string }>): Promise<{ success: boolean }>;
  clearSession(): Promise<{ success: boolean }>;
  addListener(event: string, cb: (data: any) => void): Promise<PluginListenerHandle>;
}

export interface ForumMediaPlugin {
  pickImage(o: { source: "gallery" | "camera" }): Promise<{ path: string; name: string; mime: string }>;
  uploadImage(o: { path: string; scene?: string }): Promise<ApiResponse>;
  /** 下载站内图片到 App 缓存，返回本地文件路径（用 fileSrc 转成可访问 URL） */
  fetchMedia(o: { url: string }): Promise<{ path: string }>;
}

export interface ForumUpdatePlugin {
  check(o: { version: string }): Promise<UpdateManifest>;
  download(o: {
    url: string;
    filename: string;
    size?: number;
    sha256?: string;
    mirrors?: string[];
  }): Promise<{ path: string; url: string }>;
  install(o: { path: string }): Promise<{ needsPermission: boolean }>;
  openInstallSettings(): Promise<{ success: boolean }>;
  addListener(event: string, cb: (data: any) => void): Promise<PluginListenerHandle>;
}

export interface ForumSsePlugin {
  start(o: { channel: "world" | "messages"; lastId?: string }): Promise<{ id: string }>;
  stop(o: { channel: string }): Promise<{ success: boolean }>;
  addListener(event: string, cb: (data: any) => void): Promise<PluginListenerHandle>;
}

export interface ForumDevicePlugin {
  openExternal(o: { url: string }): Promise<{ success: boolean }>;
  share(o: { text?: string; url?: string }): Promise<{ success: boolean }>;
  setStatusBar(o: { color: string; darkIcons: boolean }): Promise<{ success: boolean }>;
  vibrate(o: { duration?: number }): Promise<{ success: boolean }>;
}

export const isNative = Capacitor.isNativePlatform();

const ForumApi = registerPlugin<ForumApiPlugin>("ForumApi");
const ForumMedia = registerPlugin<ForumMediaPlugin>("ForumMedia");
const ForumUpdate = registerPlugin<ForumUpdatePlugin>("ForumUpdate");
const ForumSse = registerPlugin<ForumSsePlugin>("ForumSse");
const ForumDevice = registerPlugin<ForumDevicePlugin>("ForumDevice");

function webUrl(path: string, query?: Record<string, string>): string {
  const url = new URL(`${WEB_API_BASE}/ov2/api${path.startsWith("/") ? path : `/${path}`}`);
  Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return url.toString();
}

/** 把 fetch 的响应统一成 ApiResponse（与原生壳返回的 shape 一致）。 */
async function toApiResponse<T = any>(res: Response): Promise<ApiResponse<T>> {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data, text };
}

/** data URL → Blob（web 端上传裁剪结果用）。 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] || "image/jpeg";
  const binary = atob(body || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function extensionFor(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

async function webUpload(pathname: string, field: string, blob: Blob, scene?: string): Promise<ApiResponse> {
  const form = new FormData();
  form.append(field, blob, `upload-${Date.now()}.${extensionFor(blob.type)}`);
  const query = scene ? `?scene=${encodeURIComponent(scene)}` : "";
  const res = await fetch(`${WEB_API_BASE}/ov2/api${pathname}${query}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return toApiResponse(res);
}

async function webRequest(o: {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}): Promise<ApiResponse> {
  const method = o.method.toUpperCase();
  const res = await fetch(webUrl(o.path, o.query), {
    method,
    credentials: "include",
    headers: o.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  return toApiResponse(res);
}

export async function requestApi<T = any>(o: {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<ApiResponse<T>> {
  if (!isNative) return (await webRequest(o)) as ApiResponse<T>;
  return (await ForumApi.request(o)) as ApiResponse<T>;
}

export async function getAppInfo(): Promise<AppInfo> {
  if (!isNative) {
    return {
      versionName: "2.0.0",
      versionCode: 20000,
      packageName: "top.crazying.forum.debug",
      apiBase: WEB_API_BASE,
      apiBaseUrl: WEB_API_BASE,
      altchaConfigured: false,
    };
  }
  if (cachedAppInfo) return cachedAppInfo;
  const info = await ForumApi.getAppInfo();
  // 旧壳只下发 apiBaseUrl：统一归一到 apiBase，并让 mediaUrl 立刻跟随该基址
  cachedAppInfo = { ...info, apiBase: info.apiBase || info.apiBaseUrl || NATIVE_FALLBACK_API_BASE };
  setNativeApiBase(cachedAppInfo.apiBase);
  return cachedAppInfo;
}

export async function getStartupState(): Promise<StartupState> {
  if (!isNative) {
    return {
      hasSession: localStorage.getItem("yj_has_session") === "1",
      theme: localStorage.getItem("yj_theme"),
      yearMode: localStorage.getItem("yj_year_mode"),
      privacyAgreedVersion: localStorage.getItem("yj_privacy_version"),
    };
  }
  return ForumApi.getStartupState();
}

export async function saveSettings(o: Partial<{ theme: string; yearMode: string; privacyAgreedVersion: string; lastName: string }>) {
  if (!isNative) {
    if (o.theme) localStorage.setItem("yj_theme", o.theme);
    if (o.yearMode) localStorage.setItem("yj_year_mode", o.yearMode);
    if (o.privacyAgreedVersion) localStorage.setItem("yj_privacy_version", o.privacyAgreedVersion);
    return { success: true };
  }
  return ForumApi.saveSettings(o);
}

export async function clearSession() {
  if (!isNative) {
    localStorage.removeItem("yj_has_session");
    await webRequest({ method: "POST", path: "/auth/logout", body: {} });
    return { success: true };
  }
  return ForumApi.clearSession();
}

export async function pickImage(source: "gallery" | "camera"): Promise<{ path: string; name: string; mime: string }> {
  if (isNative) return ForumMedia.pickImage({ source });
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (source === "camera") input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error("没有选择图片"));
      const reader = new FileReader();
      reader.onload = () => resolve({ path: String(reader.result), name: file.name, mime: file.type || "image/jpeg" });
      reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

export async function uploadImage(path: string, scene = "post_image"): Promise<ApiResponse> {
  if (isNative) return ForumMedia.uploadImage({ path, scene });
  const blob = await fetch(path).then((r) => r.blob());
  return webUpload("/media/images", "file", blob, scene);
}

export async function checkUpdate(version: string): Promise<UpdateManifest> {
  if (!isNative) {
    const res = await webRequest({ method: "GET", path: "/downloads/check", query: { platform: "android", version } });
    return (res.data || { available: false }) as UpdateManifest;
  }
  return ForumUpdate.check({ version });
}

export async function downloadUpdate(o: { url: string; filename: string; size?: number; sha256?: string; mirrors?: string[] }) {
  if (!isNative) {
    window.open(o.url, "_blank", "noopener");
    return { path: o.url, url: o.url };
  }
  return ForumUpdate.download(o);
}

export async function installUpdate(path: string) {
  if (!isNative) return { needsPermission: false };
  return ForumUpdate.install({ path });
}

export async function openInstallSettings() {
  if (!isNative) return { success: true };
  return ForumUpdate.openInstallSettings();
}

export async function shareContent(o: { text?: string; url?: string }) {
  if (isNative) return ForumDevice.share(o);
  const text = [o.text, o.url].filter(Boolean).join("\n");
  if (navigator.share) {
    await navigator.share({ text, url: o.url });
  } else if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
  return { success: true };
}

export async function openExternal(url: string) {
  if (isNative) return ForumDevice.openExternal({ url });
  window.open(url, "_blank", "noopener");
  return { success: true };
}

export async function setStatusBar(color: string, darkIcons: boolean) {
  if (isNative) return ForumDevice.setStatusBar({ color, darkIcons });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", color);
  return { success: true };
}

export async function vibrate(duration = 12) {
  if (isNative) return ForumDevice.vibrate({ duration });
  navigator.vibrate?.(duration);
  return { success: true };
}

export function fileSrc(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("data:") || path.startsWith("blob:")) return path;
  if (!isNative) return path;
  return Capacitor.convertFileSrc(path);
}

export function mediaUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("data:") || path.startsWith("blob:")) return path;
  const base = isNative ? nativeApiBase || NATIVE_FALLBACK_API_BASE : WEB_API_BASE;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/* ---------------- 人机验证 ---------------- */

/** Capacitor 未实现的方法会以 UNIMPLEMENTED 拒绝：只在这种情况下才走兼容回退。 */
function isUnimplemented(error: unknown): boolean {
  const code = (error as any)?.code;
  if (code === "UNIMPLEMENTED") return true;
  return /not implemented/i.test(String((error as any)?.message || ""));
}

/** 清掉本地缓存的验证凭证（验证失败后重试前调用；未实现该方法的旧壳静默忽略）。 */
export async function clearCaptcha(): Promise<{ success: boolean }> {
  if (!isNative) return { success: true };
  try {
    return await ForumApi.clearCaptcha();
  } catch {
    return { success: false };
  }
}

/** 把服务端 /captcha/config 归一成 CaptchaStatus（旧壳只提供 captchaConfig）。 */
function normalizeCaptchaStatus(raw: any, source: "native" | "web", clientSecret?: boolean): CaptchaStatus {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: Boolean(data.enabled),
    app_enabled: Boolean(data.app_enabled),
    algorithm: data.algorithm ? String(data.algorithm) : undefined,
    cost: Number.isFinite(Number(data.cost)) ? Number(data.cost) : undefined,
    error: typeof data.error === "string" ? data.error : null,
    client_secret_configured: clientSecret,
    source,
  };
}

/** 验证通道状态：服务端开关 + 客户端密钥是否内置。 */
export async function getCaptchaStatus(): Promise<CaptchaStatus> {
  if (!isNative) {
    try {
      const res = await requestApi<any>({ method: "GET", path: "/captcha/config" });
      return normalizeCaptchaStatus(res.data, "web", false);
    } catch {
      return { enabled: false, app_enabled: false, error: "NETWORK", source: "web" };
    }
  }
  let clientSecret: boolean | undefined;
  try {
    clientSecret = (await getAppInfo()).altchaConfigured;
  } catch {
    clientSecret = undefined;
  }
  try {
    const status = await ForumApi.getCaptchaStatus();
    if (status && typeof status.enabled === "boolean") {
      return normalizeCaptchaStatus(status, "native", status.client_secret_configured ?? clientSecret);
    }
  } catch {
    /* 旧壳没有该方法，继续用 captchaConfig 兜底 */
  }
  try {
    const config = await ForumApi.captchaConfig();
    return normalizeCaptchaStatus(config, "native", clientSecret);
  } catch {
    return { enabled: false, app_enabled: false, error: "NETWORK", client_secret_configured: clientSecret, source: "native" };
  }
}

/* ---------------- 头像 / 图片上传 ---------------- */

/**
 * 头像上传：multipart 字段名 avatar，服务端成功后已回写用户资料。
 * 旧壳没有 uploadAvatar 时退化为「先传媒体，再把返回的 URL 写回 avatar」。
 */
export async function uploadAvatar(path: string): Promise<ApiResponse> {
  if (!isNative) {
    const blob = await fetch(path).then((r) => r.blob());
    return webUpload("/users/me/avatar", "avatar", blob);
  }
  try {
    return await ForumApi.uploadAvatar({ path });
  } catch (error) {
    if (!isUnimplemented(error)) throw error;
  }
  // 旧壳未实现 uploadAvatar：退化为「先传媒体，再把返回的 URL 写回 avatar」
  const uploaded = await ForumMedia.uploadImage({ path, scene: "post_image" });
  const url = (uploaded?.data as any)?.url;
  if (!uploaded?.ok || !url) return uploaded;
  const patched = await ForumApi.request({ method: "PATCH", path: "/users/me", body: { avatar: url } });
  return patched.ok ? { ...patched, data: { ...(patched.data || {}), avatar: url } } : patched;
}

/** 上传裁剪后的头像 data URL；旧壳退化为媒体上传 + PATCH avatar。 */
export async function uploadAvatarData(dataUrl: string): Promise<ApiResponse> {
  if (!isNative) return webUpload("/users/me/avatar", "avatar", dataUrlToBlob(dataUrl));
  try {
    return await ForumApi.uploadAvatarData({ dataUrl });
  } catch (error) {
    if (!isUnimplemented(error)) throw error;
  }
  const uploaded = await uploadImageData(dataUrl, "post_image");
  const url = (uploaded?.data as any)?.url;
  if (!uploaded?.ok || !url) return uploaded;
  const patched = await ForumApi.request({ method: "PATCH", path: "/users/me", body: { avatar: url } });
  return patched.ok ? { ...patched, data: { ...(patched.data || {}), avatar: url } } : patched;
}

/** 上传裁剪后的 data URL（scene 与 /media/images 的白名单一致）。 */
export async function uploadImageData(dataUrl: string, scene = "post_image"): Promise<ApiResponse> {
  if (isNative) {
    try {
      return await ForumApi.uploadImageData({ dataUrl, scene });
    } catch (error) {
      if (!isUnimplemented(error)) throw error;
      return {
        status: 0,
        ok: false,
        data: { success: false, message: "当前客户端版本不支持直接上传裁剪图片，请更新 App 后重试" },
        text: "",
      };
    }
  }
  return webUpload("/media/images", "file", dataUrlToBlob(dataUrl), scene);
}

/**
 * 下载站内图片，返回可直接放进 img.src 的地址：
 * 原生壳落到缓存文件（fileSrc 转换），web 兑底成 data URL。
 */
export async function fetchMedia(input: string): Promise<string> {
  if (!input) return "";
  if (input.startsWith("data:") || input.startsWith("blob:")) return input;
  const target = /^https?:/.test(input)
    ? input
    : /^\/(ov2\/api|avatar|static)\//.test(input)
      ? mediaUrl(input)
      : fileSrc(input);
  if (isNative) {
    try {
      const res = await ForumMedia.fetchMedia({ url: target });
      if (res?.path) return fileSrc(res.path);
    } catch {
      /* 旧壳未实现：继续用 fetch 兑底（公开媒体可直接读） */
    }
  }
  const res = await fetch(target, { credentials: "include" });
  if (!res.ok) throw new Error("图片下载失败");
  const blob = await res.blob();
  if (typeof FileReader === "undefined") return target;
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

export async function onSessionExpired(cb: () => void) {
  if (!isNative) return;
  await ForumApi.addListener("sessionExpired", cb);
}

export async function onVersionTooLow(cb: (data: { status: number }) => void) {
  if (!isNative) return;
  await ForumApi.addListener("versionTooLow", cb);
}

export async function onUpdateProgress(cb: (data: { received: number; total: number; percent: number; url: string }) => void) {
  if (!isNative) return;
  await ForumUpdate.addListener("updateProgress", cb);
}

const webSseHandlers: Array<(data: any) => void> = [];
const webSseSources = new Map<string, EventSource>();

export const sse = {
  async start(o: { channel: "world" | "messages"; lastId?: string }) {
    if (isNative) return ForumSse.start(o);
    webSseSources.get(o.channel)?.close();
    const url = new URL(webUrl(o.channel === "messages" ? "/messages/stream" : "/world/stream"));
    if (o.lastId) url.searchParams.set("last_id", o.lastId);
    const source = new EventSource(url.toString(), { withCredentials: true });
    source.onmessage = (event) => {
      webSseHandlers.forEach((cb) => cb({ channel: o.channel, event: "message", data: event.data, id: (event as any).lastEventId }));
    };
    source.onerror = () => {
      webSseHandlers.forEach((cb) => cb({ channel: o.channel, state: "disconnected" }));
    };
    webSseSources.set(o.channel, source);
    return { id: o.channel };
  },
  async stop(o: { channel: string }) {
    if (isNative) return ForumSse.stop(o);
    webSseSources.get(o.channel)?.close();
    webSseSources.delete(o.channel);
    return { success: true };
  },
  async addListener(event: string, cb: (data: any) => void): Promise<PluginListenerHandle> {
    if (isNative) return ForumSse.addListener(event, cb);
    if (event === "sse") webSseHandlers.push(cb);
    return {
      remove: async () => {
        const index = webSseHandlers.indexOf(cb);
        if (index >= 0) webSseHandlers.splice(index, 1);
      },
    };
  },
};
