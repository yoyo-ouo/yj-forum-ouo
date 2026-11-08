import React, { useEffect, useLayoutEffect, useRef } from "react";
import { scrollMemory, useNav, type TabKey } from "../lib/nav";
import { registerBackHandler } from "../lib/back";
import { useApp } from "../lib/store";
import { avatarUrl } from "../lib/format";
import { Icon, type IconName } from "./icons";

/* ---------------- 页面容器 ---------------- */

export function Screen({
  appbar,
  footer,
  children,
  className = "",
  bodyClassName = "",
  onRefresh,
  pullDisabled = false,
}: {
  appbar?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  onRefresh?: () => Promise<void> | void;
  /** 内层自己滚动的页面（聊天）关掉下拉刷新，避免抢手势 */
  pullDisabled?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { top, tab } = useNav();
  const key = `${tab}:${top.key}`;
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);

  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const target = scrollMemory.get(key) || 0;
    if (target <= 0) return;
    let done = false;
    let raf = 0;
    const apply = () => {
      if (done || !bodyRef.current) return;
      node.scrollTop = target;
      if (Math.abs(node.scrollTop - target) <= 2) done = true;
    };
    raf = requestAnimationFrame(apply);
    // 列表是异步渲染的：内容长高后继续尝试，直到命中超时
    const observer = new ResizeObserver(apply);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    observer.observe(node);
    const cancel = () => { done = true; };
    node.addEventListener("touchstart", cancel, { passive: true });
    node.addEventListener("wheel", cancel, { passive: true });
    const stop = window.setTimeout(() => { done = true; observer.disconnect(); }, 5000);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.clearTimeout(stop);
      node.removeEventListener("touchstart", cancel);
      node.removeEventListener("wheel", cancel);
      if (bodyRef.current) scrollMemory.set(key, bodyRef.current.scrollTop);
    };
  }, [key]);

  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        scrollMemory.set(key, node.scrollTop);
      });
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [key]);

  useEffect(() => {
    const node = bodyRef.current;
    if (!node || !onRefresh || pullDisabled) return;
    const onStart = (event: TouchEvent) => {
      if (node.scrollTop > 2 || refreshing || node.scrollHeight <= node.clientHeight) return;
      startY.current = event.touches[0].clientY;
    };
    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const delta = event.touches[0].clientY - startY.current;
      const next = delta <= 0 ? 0 : Math.min(84, delta * 0.48);
      pullRef.current = next;
      setPull(next);
    };
    const onEnd = async () => {
      if (startY.current === null) return;
      const reached = pullRef.current > 46;
      startY.current = null;
      pullRef.current = 0;
      setPull(0);
      if (!reached) return;
      setRefreshing(true);
      try { await onRefresh(); } finally { setRefreshing(false); }
    };
    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: true });
    node.addEventListener("touchend", onEnd);
    node.addEventListener("touchcancel", onEnd);
    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
      node.removeEventListener("touchcancel", onEnd);
    };
  }, [onRefresh, refreshing, pullDisabled]);

  return (
    <div className={`m-screen m-page-in ${className}`.trim()}>
      {appbar}
      <div ref={bodyRef} className={`m-body ${bodyClassName}`.trim()}>
        {onRefresh && !pullDisabled ? (
          <div
            className="m-pull"
            style={{ height: refreshing ? 46 : pull, opacity: refreshing || pull > 8 ? 1 : 0 }}
          >
            <span className={refreshing ? "m-spinner" : "m-pull-dot"} />
            <span className="m-small m-muted">{refreshing ? "正在刷新…" : pull > 46 ? "松开刷新" : "下拉刷新"}</span>
          </div>
        ) : null}
        {children}
      </div>
      {footer}
    </div>
  );
}

/* ---------------- 顶栏 ---------------- */

export function AppBar({
  title,
  back,
  actions,
  center,
  plain,
  children,
}: {
  title?: React.ReactNode;
  back?: boolean;
  actions?: React.ReactNode;
  center?: boolean;
  plain?: boolean;
  children?: React.ReactNode;
}) {
  const { pop } = useNav();
  return (
    <header className={`m-appbar ${center ? "m-appbar--center" : ""} ${plain ? "m-appbar--plain" : ""}`.trim()}>
      {back ? (
        <button className="m-iconbtn" aria-label="返回" onClick={pop}>
          <Icon name="back" size={23} />
        </button>
      ) : null}
      {children ? <div className="m-appbar-sub">{children}</div> : null}
      {title !== undefined ? <div className="m-appbar-title">{title}</div> : null}
      {back || center ? <div className="m-appbar-side" /> : null}
      <div className="m-appbar-side">{actions}</div>
    </header>
  );
}

/* ---------------- 底部导航 ---------------- */

export function TabBar() {
  const { tab, switchTab, push, showTab } = useNav();
  const unread = useApp((s) => s.unread);
  const badge = unread.likes + unread.comments + unread.system + unread.chat;

  const item = (key: TabKey, icon: IconName, label: string) => (
    <button key={key} className={`m-tab ${tab === key ? "on" : ""}`} onClick={() => switchTab(key)} aria-label={label} aria-current={tab === key ? "page" : undefined}>
      <Icon name={icon} size={23} />
      <span>{label}</span>
      {key === "messages" && badge > 0 ? <i className="m-tab-badge">{badge > 99 ? "99+" : badge}</i> : null}
    </button>
  );

  if (!showTab) return null;
  return (
    <nav className="m-tabbar">
      {item("square", "grid", "广场")}
      {item("world", "globe", "世界")}
      <button className="m-fab" aria-label="发帖" onClick={() => push("compose")}>
        <Icon name="plus" size={24} />
      </button>
      {item("messages", "bell", "消息")}
      {item("me", "user", "我的")}
    </nav>
  );
}

/* ---------------- 基础原子 ---------------- */

export function IconButton({
  icon,
  label,
  onClick,
  accent,
  badge,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  accent?: boolean;
  badge?: number;
  disabled?: boolean;
}) {
  return (
    <button className={`m-iconbtn ${accent ? "m-accent" : ""}`.trim()} aria-label={label} onClick={onClick} disabled={disabled} style={{ position: "relative" }}>
      <Icon name={icon} size={22} />
      {badge && badge > 0 ? (
        <i
          style={{
            position: "absolute", top: 4, right: 4, minWidth: 15, height: 15, borderRadius: 999,
            background: "#e5484d", color: "#fff", fontSize: 9, fontStyle: "normal",
            display: "grid", placeItems: "center", padding: "0 3px", lineHeight: 1,
          }}
        >
          {badge > 99 ? "99+" : badge}
        </i>
      ) : null}
    </button>
  );
}

export function Avatar({ src, name, size = 36 }: { src?: string | null; name?: string; size?: number }) {
  const url = avatarUrl(src);
  return (
    <span
      className="m-avatar"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
    >
      {url ? <img src={url} alt={name || ""} loading="lazy" /> : <Icon name="user" size={Math.round(size * 0.46)} />}
    </span>
  );
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  className = "",
}: {
  items: { key: T; label: React.ReactNode }[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={`m-seg ${className}`.trim()} role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={value === item.key}
          className={`m-seg-btn ${value === item.key ? "on" : ""}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Cell({
  icon,
  label,
  sub,
  value,
  onClick,
  danger,
  chevron = true,
  right,
}: {
  icon?: IconName;
  label: React.ReactNode;
  sub?: React.ReactNode;
  value?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  chevron?: boolean;
  right?: React.ReactNode;
}) {
  const inner = (
    <>
      {icon ? <span className="m-cell-icon"><Icon name={icon} size={18} /></span> : null}
      <span className="m-cell-label">
        <span className="m-ellipsis" style={{ display: "block" }}>{label}</span>
        {sub ? <span className="m-cell-sub" style={{ display: "block" }}>{sub}</span> : null}
      </span>
      {value !== undefined ? <span className="m-cell-value">{value}</span> : null}
      {right}
      {chevron && onClick ? <Icon name="forward" size={18} className="m-cell-chev" /> : null}
    </>
  );
  if (!onClick) {
    return <div className={`m-cell m-cell--static ${danger ? "m-cell--danger" : ""}`.trim()}>{inner}</div>;
  }
  return (
    <button className={`m-cell ${danger ? "m-cell--danger" : ""}`.trim()} onClick={onClick}>
      {inner}
    </button>
  );
}

export function Empty({
  icon = "sparkle",
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="m-empty">
      <div className="m-empty-art"><Icon name={icon} size={26} /></div>
      <div className="m-empty-title">{title}</div>
      {hint ? <div className="m-empty-hint">{hint}</div> : null}
      {action}
    </div>
  );
}

export function Loader({ text = "加载中" }: { text?: string }) {
  return (
    <div className="m-loading">
      <span className="m-spinner" />
      <span>{text}</span>
    </div>
  );
}

export function Skeletons({ count = 3 }: { count?: number }) {
  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="m-card" style={{ padding: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="m-skel" style={{ width: 38, height: 38, borderRadius: 999 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
              <div className="m-skel" style={{ width: "42%", height: 11 }} />
              <div className="m-skel" style={{ width: "26%", height: 9 }} />
            </div>
          </div>
          <div className="m-skel" style={{ width: "86%", height: 15, marginTop: 14 }} />
          <div className="m-skel" style={{ width: "100%", height: 11, marginTop: 10 }} />
          <div className="m-skel" style={{ width: "72%", height: 11, marginTop: 7 }} />
        </div>
      ))}
    </div>
  );
}

/* ---------------- 弹层 ---------------- */

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => {
      onClose();
      return true;
    });
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="m-mask" onClick={onClose}>
      <div className="m-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="m-sheet-grip" />
        <div className="m-sheet-head">
          <strong style={{ flex: 1 }}>{title}</strong>
          <button className="m-iconbtn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
        {footer ? <div className="m-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  children,
  confirmText = "确定",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => {
      onCancel();
      return true;
    });
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="m-mask" onClick={onCancel} style={{ alignItems: "center" }}>
      <div className="m-confirm" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <div className="m-confirm-body">{children}</div>
        <div className="m-confirm-actions">
          <button className="m-btn m-btn--ghost" onClick={onCancel}>取消</button>
          <button className="m-btn m-btn--primary" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

export function ToastHost() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  return <div className={`m-toast ${toast.kind === "error" ? "m-toast--error" : ""}`.trim()}>{toast.message}</div>;
}


