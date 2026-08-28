"use client";

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  icon: string;
  leaving?: boolean;
}

interface ToastCtx {
  toast: (message: string, type?: ToastType) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });

const TYPE_ICON: Record<ToastType, string> = {
  success: "fa fa-check",
  error: "fa fa-times",
  info: "fa fa-info",
  warning: "fa fa-exclamation-triangle",
};

const DURATION = 1100; // 展示时长(ms)
const LEAVE_MS = 250; // 离场动画时长
let uid = 0;

/**
 * 胶囊状态提醒 Toast(全局,单例挂在 layout)。
 * 用法:const { toast } = useToast();
 *   toast("操作成功");        // 默认 info
 *   toast("保存成功", "success");
 *   toast("保存失败", "error");
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    timers.current[id] = setTimeout(() => remove(id), LEAVE_MS);
  }, [remove]);

  const toast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = ++uid;
      setItems((list) => [...list, { id, type, message, icon: TYPE_ICON[type] }]);
      timers.current[id] = setTimeout(() => dismiss(id), DURATION);
    },
    [dismiss]
  );

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-container" id="toast-container" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast-pill toast-${t.type}${t.leaving ? " toast-leaving" : ""}`}
            onClick={() => dismiss(t.id)}
            role="status"
          >
            <i className={t.icon}></i>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
