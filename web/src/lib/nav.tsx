import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { registerBackHandler } from "./back";

export type TabKey = "square" | "world" | "messages" | "me";

export interface ScreenEntry {
  name: string;
  params?: Record<string, any>;
}

interface NavApi {
  tab: TabKey;
  stack: ScreenEntry[];
  top: ScreenEntry;
  canGoBack: boolean;
  push: (name: string, params?: Record<string, any>) => void;
  replace: (name: string, params?: Record<string, any>) => void;
  pop: () => void;
  switchTab: (tab: TabKey) => void;
  reset: (name: string, params?: Record<string, any>) => void;
}

const NavContext = createContext<NavApi | null>(null);

const ROOTS: Record<TabKey, string> = {
  square: "feed",
  world: "world",
  messages: "messages",
  me: "me",
};

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState<TabKey>("square");
  const [stack, setStack] = useState<ScreenEntry[]>([{ name: ROOTS.square }]);

  useEffect(() => {
    history.replaceState({ yjDepth: 0 }, "");
    const onPop = () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const push = useCallback((name: string, params: Record<string, any> = {}) => {
    setStack((current) => {
      history.pushState({ yjDepth: current.length + 1 }, "");
      return [...current, { name, params }];
    });
  }, []);

  const replace = useCallback((name: string, params: Record<string, any> = {}) => {
    setStack((current) => [...current.slice(0, -1), { name, params }]);
  }, []);

  const pop = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  const switchTab = useCallback((next: TabKey) => {
    setTab(next);
    setStack((current) => {
      const root = ROOTS[next];
      if (current.length === 1 && current[0].name === root) return current;
      history.pushState({ yjDepth: 0 }, "");
      return [{ name: root }];
    });
  }, []);

  const reset = useCallback((name: string, params: Record<string, any> = {}) => {
    setStack([{ name, params }]);
  }, []);

  useEffect(() => registerBackHandler(() => {
    if (stack.length <= 1) return false;
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
    return true;
  }), [stack.length]);

  const value = useMemo<NavApi>(() => {
    const top = stack[stack.length - 1];
    return { tab, stack, top, canGoBack: stack.length > 1, push, replace, pop, switchTab, reset };
  }, [tab, stack, push, replace, pop, switchTab, reset]);

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
  const context = useContext(NavContext);
  if (!context) throw new Error("useNav must be used inside NavProvider");
  return context;
}
