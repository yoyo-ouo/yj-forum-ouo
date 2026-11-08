import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { ApiResponse, AppInfo, StartupState, UpdateManifest } from "./types";

const WEB_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "http://127.0.0.1:8090";

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
  getAppInfo(): Promise<AppInfo>;
  getStartupState(): Promise<StartupState>;
  saveSettings(o: Partial<{ theme: string; yearMode: string; privacyAgreedVersion: string; lastName: string }>): Promise<{ success: boolean }>;
  clearSession(): Promise<{ success: boolean }>;
  addListener(event: string, cb: (data: any) => void): Promise<PluginListenerHandle>;
}

export interface ForumMediaPlugin {
  pickImage(o: { source: "gallery" | "camera" }): Promise<{ path: string; name: string; mime: string }>;
  uploadImage(o: { path: string; scene?: string }): Promise<ApiResponse>;
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
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data, text };
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
      apiBaseUrl: WEB_API_BASE,
      altchaConfigured: false,
    };
  }
  return ForumApi.getAppInfo();
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
  const form = new FormData();
  form.append("file", blob, path.startsWith("data:") ? `upload-${Date.now()}.jpg` : path.split("/").pop() || "upload.jpg");
  const res = await fetch(`${WEB_API_BASE}/ov2/api/media/images?scene=${encodeURIComponent(scene)}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const text = await res.text();
 let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data, text };
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
  const base = isNative ? "https://www.yjlt.top" : WEB_API_BASE;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
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
