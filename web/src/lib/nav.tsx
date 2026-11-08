import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { registerBackHandler } from "./back";

export type TabKey = "square" | "world" | "messages" | "me";

export interface ScreenEntry {
  name: string;
  params?: Record<string, any>;
  /** 唯一标识：转场动画与滚动位置记忆 */
  key: string;
}

type StackMap = Record<TabKey, ScreenEntry[]>;

interface NavApi {
  tab: TabKey;
  stack: ScreenEntry[];
  top: ScreenEntry;
  canGoBack: boolean;
  /** 仅一级页显示底部 TabBar，二级页全屏 */
  showTab: boolean;
  push: (name: string, params?: Record<string, any>) => void;
  replace: (name: string, params?: Record<string, any>) => void;
  pop: () => void;
  switchTab: (tab: TabKey) => void;
  reset: (name: string, params?: Record<string, any>) => void;
}

const NavContext = createContext<NavApi | null>(null);

const ROOTS: Record<TabKey, string> = { square: "feed", world: "world", messages: "messages", me: "me" };
const TAB_ORDER: TabKey[] = ["square", "world", "messages", "me"];

let counter = 0;
const entry = (name: string, params?: Record<string, any>): ScreenEntry => ({ name, params, key: `${name}#${++counter}` });

/** 每个 Tab 各自的阅读位置 */
export const scrollMemory = new Map<string, number>();

const initialStacks = (): StackMap => ({
  square: [entry(ROOTS.square)],
  world: [entry(ROOTS.world)],
  messages: [entry(ROOTS.messages)],
  me: [entry(ROOTS.me)],
});

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState<TabKey>("square");
  const [stacks, setStacks] = useState<StackMap>(initialStacks);

  // 返回键处理器只注册一次。deps 带 stacks 时每次 push/pop 都会重新注册，
  // 而 effect 顺序是「子先父后」，导航层会抢在弹层/确认框之前把页面退掉。
  const stacksRef = useRef(stacks);
  const tabRef = useRef(tab);
  stacksRef.current = stacks;
  tabRef.current = tab;

  useEffect(() => {
    history.replaceState({ yjDepth: 0 }, "");
    const onPop = () => {
      const currentTab = tabRef.current;
      setStacks((current) => {
        const list = current[currentTab];
        if (list.length <= 1) return current;
        return { ...current, [currentTab]: list.slice(0, -1) };
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const push = useCallback((name: string, params: Record<string, any> = {}) => {
    setStacks((current) => {
      const list = current[tab];
      history.pushState({ yjDepth: list.length }, "");
      return { ...current, [tab]: [...list, entry(name, params)] };
    });
  }, [tab]);

  const replace = useCallback((name: string, params: Record<string, any> = {}) => {
    setStacks((current) => ({ ...current, [tab]: [...current[tab].slice(0, -1), entry(name, params)] }));
  }, [tab]);

  const pop = useCallback(() => {
    setStacks((current) => {
      const list = current[tab];
      return list.length <= 1 ? current : { ...current, [tab]: list.slice(0, -1) };
    });
  }, [tab]);

  const switchTab = useCallback((next: TabKey) => {
    if (next === tab) {
      setStacks((current) => {
        const list = current[next];
        return list.length <= 1 ? current : { ...current, [next]: [list[0]] };
      });
      return;
    }
    setTab(next);
    history.replaceState({ yjDepth: 0 }, "");
  }, [tab]);

  const reset = useCallback((name: string, params: Record<string, any> = {}) => {
    setStacks((current) => ({ ...current, [tab]: [entry(name, params)] }));
  }, [tab]);

  const stack = stacks[tab];

  useEffect(() => registerBackHandler(() => {
    const currentTab = tabRef.current;
    if (stacksRef.current[currentTab].length <= 1) return false;
    setStacks((current) => {
      const list = current[currentTab];
      return list.length <= 1 ? current : { ...current, [currentTab]: list.slice(0, -1) };
    });
    return true;
  }), []);

  const value = useMemo<NavApi>(() => {
    const top = stack[stack.length - 1];
    return {
      tab,
      stack,
      top,
      canGoBack: stack.length > 1,
      showTab: stack.length === 1,
      push,
      replace,
      pop,
      switchTab,
      reset,
    };
  }, [tab, stack, push, replace, pop, switchTab, reset]);

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
  const context = useContext(NavContext);
  if (!context) throw new Error("useNav must be used inside NavProvider");
  return context;
}

export const TAB_LABEL: Record<TabKey, string> = { square: "广场", world: "世界", messages: "消息", me: "我的" };

export { TAB_ORDER };

