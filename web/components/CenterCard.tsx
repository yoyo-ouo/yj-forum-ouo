"use client";

import { createContext, useCallback, useContext, useState, ReactNode } from "react";

/**
 * 全局居中弹窗（WindowsCardWithCenterSreen 的原生 React 实现）。
 * 替代 legacy 的 document.getElementById + innerHTML 的 DOM 操作。
 * 用法：const { show } = useCenterCard(); show(<p>...</p>);
 */
interface CenterCardCtx {
  show: (node: ReactNode) => void;
  hide: () => void;
}

const Ctx = createContext<CenterCardCtx>({ show: () => {}, hide: () => {} });

export function CenterCardProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const [open, setOpen] = useState(false);

  const show = useCallback((node: ReactNode) => {
    setContent(node);
    setOpen(true);
    document.body.style.overflow = "hidden";
  }, []);

  const hide = useCallback(() => {
    setOpen(false);
    document.body.style.overflow = "";
  }, []);

  return (
    <Ctx.Provider value={{ show, hide }}>
      {children}
      <div id="WindowsCardWithCenterSreen" className={open ? "active" : ""}>
        <button className="windows-card-close" onClick={hide} aria-label="关闭">
          &times;
        </button>
        <div id="WindowsCardWithCenterSreenText" className="windows-card">
          {content}
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function useCenterCard() {
  return useContext(Ctx);
}
