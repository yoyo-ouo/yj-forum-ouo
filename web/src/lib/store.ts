import { create } from "zustand";
import { api } from "./api";
import { getAppInfo, getStartupState, saveSettings, setStatusBar } from "./native";
import type { AppInfo, StartupState, Theme, UpdateManifest, User } from "./types";

export const PRIVACY_VERSION = "2.2";

interface AppState {
  booted: boolean;
  user: User | null;
  appInfo: AppInfo | null;
  startup: StartupState | null;
  theme: Theme;
  yearMode: "wuxian" | "ce";
  consented: boolean;
  update: UpdateManifest | null;
  updateDismissed: boolean;
  unread: { likes: number; comments: number; system: number; chat: number };
  toast: { message: string; kind: "info" | "error" } | null;
  boot: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: User | null) => void;
  setTheme: (theme: Theme) => void;
  setYearMode: (mode: "wuxian" | "ce") => void;
  consent: () => Promise<void>;
  showToast: (message: string, kind?: "info" | "error") => void;
  setUpdate: (manifest: UpdateManifest | null) => void;
  dismissUpdate: () => void;
  setUnread: (unread: AppState["unread"]) => void;
  logout: () => Promise<void>;
}

function resolveNight(theme: Theme): boolean {
  if (theme === "night") return true;
  if (theme === "day") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: Theme) {
  const night = resolveNight(theme);
  document.documentElement.classList.toggle("night-mode", night);
  document.documentElement.dataset.theme = night ? "night" : "day";
  void setStatusBar(night ? "#325A64" : "#D8E6E4", !night);
}

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  user: null,
  appInfo: null,
  startup: null,
  theme: "auto",
  yearMode: "wuxian",
  consented: false,
  update: null,
  updateDismissed: false,
  unread: { likes: 0, comments: 0, system: 0, chat: 0 },
  toast: null,

  async boot() {
    const [appInfo, startup, user] = await Promise.all([
      getAppInfo().catch(() => null),
      getStartupState().catch(() => null),
      api.me().catch(() => null),
    ]);
    const theme = (startup?.theme as Theme) || "auto";
    const consented = startup?.privacyAgreedVersion === PRIVACY_VERSION;
    set({
      booted: true,
      appInfo,
      startup,
      user,
      theme,
      yearMode: startup?.yearMode === "ce" ? "ce" : "wuxian",
      consented,
    });
    applyTheme(theme);
    if (user) void api.messagesSummary().then((summary) => set({ unread: summary })).catch(() => undefined);
  },

  async refreshUser() {
    const user = await api.me().catch(() => null);
    set({ user });
    if (user) void api.messagesSummary().then((summary) => set({ unread: summary })).catch(() => undefined);
  },

  setUser: (user) => set({ user }),

  setTheme(theme) {
    set({ theme });
    applyTheme(theme);
    void saveSettings({ theme });
  },

  setYearMode(yearMode) {
    set({ yearMode });
    void saveSettings({ yearMode });
  },

  async consent() {
    set({ consented: true });
    await saveSettings({ privacyAgreedVersion: PRIVACY_VERSION });
  },

  showToast(message, kind = "info") {
    set({ toast: { message, kind } });
    window.setTimeout(() => {
      if (get().toast?.message === message) set({ toast: null });
    }, 2400);
  },

  setUpdate: (update) => set({ update, updateDismissed: false }),
  dismissUpdate: () => set({ updateDismissed: true }),
  setUnread: (unread) => set({ unread }),

  async logout() {
    await api.logout().catch(() => undefined);
    set({ user: null, unread: { likes: 0, comments: 0, system: 0, chat: 0 } });
  },
}));
