"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { userApi, authApi, User, ApiException } from "./api";

type Theme = "day" | "night" | "default";

interface StoreState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  user: User | null;
  loadingUser: boolean;
  refreshUser: () => Promise<void>;
  userId: string | null;
  logout: () => Promise<void>;
}

const StoreContext = createContext<StoreState>({
  theme: "default",
  setTheme: () => {},
  user: null,
  loadingUser: true,
  refreshUser: async () => {},
  userId: null,
  logout: async () => {},
});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("default");
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // 主题：读取 localStorage + 默认按时间
  useEffect(() => {
    const saved = localStorage.getItem("forum-theme") as Theme | null;
    if (saved === "day" || saved === "night") {
      setThemeState(saved);
      applyTheme(saved);
    } else {
      const h = new Date().getHours();
      const auto: Theme = h < 6 || h >= 18 ? "night" : "day";
      setThemeState("default");
      applyTheme(auto);
    }
  }, []);

  const applyTheme = (t: Theme) => {
    if (t === "night") document.documentElement.classList.add("night-mode");
    else document.documentElement.classList.remove("night-mode");
  };

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("forum-theme", t);
    if (t === "default") {
      const h = new Date().getHours();
      applyTheme(h < 6 || h >= 18 ? "night" : "day");
    } else {
      applyTheme(t);
    }
  }, []);

  const getUserIdFromCookie = useCallback(() => {
    if (typeof document === "undefined") return null;
    const m = document.cookie.match(/(?:^|;\s*)user_id=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await userApi.me();
      if (res.user) {
        setUser(res.user);
        setUserId(res.user.id);
      } else {
        setUser(null);
        setUserId(getUserIdFromCookie());
      }
    } catch (e) {
      if (e instanceof ApiException && e.status === 401) {
        setUser(null);
      }
      setUserId(getUserIdFromCookie());
    } finally {
      setLoadingUser(false);
    }
  }, [getUserIdFromCookie]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // 忽略
    }
    setUser(null);
    setUserId(null);
    window.location.reload();
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return (
    <StoreContext.Provider value={{ theme, setTheme, user, loadingUser, refreshUser, userId, logout }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  return useContext(StoreContext);
}
