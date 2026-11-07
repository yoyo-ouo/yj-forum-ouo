"use client";

// ===== 通用悬浮窗外壳 =====
// 与世界频道同一套技术：createPortal + 标题栏拖拽 + 右/下/右下三向 resize +
// 视口 clamp + localStorage 记忆位置与尺寸 + 移动端底部近全屏 sheet + ESC / 返回键关闭。
// 纯悬浮窗：桌面无遮罩、不锁滚动、不拦截底层页面交互；移动端才铺遮罩并锁滚动。

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_FLOATING_BOUNDS,
  MOBILE_MEDIA_QUERY,
  clampResizeSize,
  clampWindowPosition,
  clampWindowSize,
  isMobileViewport,
  readStoredPosition,
  readStoredSize,
  saveStoredPosition,
  saveStoredSize,
  type FloatingBounds,
  type WindowPosition,
  type WindowSize,
} from "@/lib/floating-window";

type ResizeDirection = "e" | "s" | "se";

const EMPTY_SUBSCRIBE = () => () => {};

function useIsClient(): boolean {
  return useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    () => true,
    () => false
  );
}

/** 分部件类名（世界频道传自己的命名，保持既有 CSS 不失效） */
export interface FloatingWindowClasses {
  overlay?: string;
  root?: string;
  header?: string;
  titleWrap?: string;
  title?: string;
  close?: string;
  body?: string;
  footer?: string;
  resizeHandle?: string;
}

const DEFAULT_CLASSES: Required<FloatingWindowClasses> = {
  overlay: "fw-overlay",
  root: "fw-window",
  header: "fw-header",
  titleWrap: "fw-title-wrap",
  title: "fw-title",
  close: "fw-close",
  body: "fw-body",
  footer: "fw-footer",
  resizeHandle: "fw-resize",
};

export interface FloatingWindowProps {
  open: boolean;
  onClose: () => void;
  /** 标题栏内容（含图标） */
  title: ReactNode;
  /** 标题栏附加区（如状态胶囊） */
  headerExtra?: ReactNode;
  /** 底部固定区（如操作条） */
  footer?: ReactNode;
  children: ReactNode;
  classes?: FloatingWindowClasses;
  /** 追加到根节点的类名 */
  className?: string;
  /** localStorage 键前缀（位置/尺寸各自 + `:window-position` / `:window-size`） */
  storageKeyPrefix: string;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  /** 首次打开的水平位置：right = 靠右，center = 居中 */
  placement?: "right" | "center";
  mobileMediaQuery?: string;
  titleId?: string;
  closeAriaLabel?: string;
  /** ESC 时需要让位的选择器（如已打开的编辑器弹窗） */
  escapeGuardSelector?: string;
  /** 移动端是否锁页面滚动（默认 true） */
  lockScroll?: boolean;
}

/** 通用悬浮窗。 */
const FloatingWindow = memo(function FloatingWindow({
  open,
  onClose,
  title,
  headerExtra,
  footer,
  children,
  classes,
  className = "",
  storageKeyPrefix,
  defaultWidth = DEFAULT_FLOATING_BOUNDS.defaultWidth,
  defaultHeight = DEFAULT_FLOATING_BOUNDS.defaultHeight,
  minWidth = DEFAULT_FLOATING_BOUNDS.minWidth,
  minHeight = DEFAULT_FLOATING_BOUNDS.minHeight,
  placement = "right",
  mobileMediaQuery = MOBILE_MEDIA_QUERY,
  titleId,
  closeAriaLabel = "关闭",
  escapeGuardSelector,
  lockScroll = true,
}: FloatingWindowProps) {
  const isClient = useIsClient();
  const cls = { ...DEFAULT_CLASSES, ...(classes || {}) };

  const bounds: FloatingBounds = useMemo(
    () => ({
      ...DEFAULT_FLOATING_BOUNDS,
      defaultWidth,
      defaultHeight,
      minWidth,
      minHeight,
    }),
    [defaultWidth, defaultHeight, minWidth, minHeight]
  );
  const boundsRef = useRef(bounds);
  const mobileQueryRef = useRef(mobileMediaQuery);

  const [isMobile, setIsMobile] = useState<boolean>(() => isMobileViewport(mobileMediaQuery));
  const [position, setPosition] = useState<WindowPosition | null>(null);
  const [size, setSize] = useState<WindowSize | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const positionRef = useRef<WindowPosition | null>(null);
  const sizeRef = useRef<WindowSize | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
  } | null>(null);
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
    direction: ResizeDirection;
  } | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const historyPushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);

  const positionKey = `${storageKeyPrefix}:window-position`;
  const sizeKey = `${storageKeyPrefix}:window-size`;

  const applyPosition = useCallback((next: WindowPosition) => {
    positionRef.current = next;
    setPosition(next);
  }, []);
  const applySize = useCallback((next: WindowSize) => {
    sizeRef.current = next;
    setSize(next);
  }, []);

  const requestClose = useCallback(() => {
    if (historyPushedRef.current) {
      historyPushedRef.current = false;
      try {
        window.history.back();
      } catch {
        /* 忽略 */
      }
    }
    onCloseRef.current();
  }, []);

  // 同步最新 props 到 ref（供事件回调与 effect 闭包读取）
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);
  useEffect(() => {
    mobileQueryRef.current = mobileMediaQuery;
  }, [mobileMediaQuery]);

  // 断点：matchMedia + resize 双保险
  useEffect(() => {
    const mq = window.matchMedia(mobileMediaQuery);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [mobileMediaQuery]);

  // 打开时：读记忆 + clamp + 应用
  useEffect(() => {
    if (!open || !isClient || isMobile) return;
    const storedSize = readStoredSize(sizeKey);
    const nextSize = clampWindowSize(
      storedSize?.width ?? boundsRef.current.defaultWidth,
      storedSize?.height ?? boundsRef.current.defaultHeight,
      boundsRef.current
    );
    const stored = readStoredPosition(positionKey);
    const fallbackLeft =
      placement === "center"
        ? (window.innerWidth - nextSize.width) / 2
        : window.innerWidth - nextSize.width - 88;
    let cancelled = false;
    // 用微任务而不是 rAF：后台标签页会暂停 rAF，导致记忆不生效
    queueMicrotask(() => {
      if (cancelled) return;
      applySize(nextSize);
      applyPosition(
        clampWindowPosition(
          stored?.left ?? fallbackLeft,
          stored?.top ?? boundsRef.current.desktopTop,
          nextSize.width,
          nextSize.height,
          boundsRef.current,
          mobileQueryRef.current
        )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, isClient, isMobile, positionKey, sizeKey, placement, applyPosition, applySize]);

  // 视口变化：重新 clamp（不写 storage）
  useEffect(() => {
    if (!open || !isClient || isMobile) return;
    const onResize = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const currentSize = sizeRef.current;
      const nextSize = clampWindowSize(
        currentSize?.width ?? dialog.offsetWidth,
        currentSize?.height ?? dialog.offsetHeight,
        boundsRef.current
      );
      if (!currentSize || nextSize.width !== currentSize.width || nextSize.height !== currentSize.height) {
        applySize(nextSize);
      }
      const current = positionRef.current;
      if (current) {
        applyPosition(
          clampWindowPosition(
            current.left,
            current.top,
            nextSize.width,
            nextSize.height,
            boundsRef.current,
            mobileQueryRef.current
          )
        );
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, isClient, isMobile, applyPosition, applySize]);

  // 移动端 Android 返回键：先关窗
  useEffect(() => {
    if (!open || !isClient || !isMobile) return;
    historyPushedRef.current = true;
    try {
      const currentState = window.history.state as Record<string, unknown> | null;
      window.history.pushState({ ...(currentState ?? {}), floatingWindow: true }, "");
    } catch {
      historyPushedRef.current = false;
    }
    const onPopState = () => {
      if (!historyPushedRef.current) return;
      historyPushedRef.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (historyPushedRef.current && openRef.current && !isMobileViewport(mobileQueryRef.current)) {
        historyPushedRef.current = false;
        try {
          window.history.back();
        } catch {
          /* 忽略 */
        }
      } else {
        historyPushedRef.current = false;
      }
    };
  }, [open, isClient, isMobile]);

  // ESC 关闭（让位给上层弹窗）
  useEffect(() => {
    if (!open || !isClient) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (escapeGuardSelector && document.querySelector(escapeGuardSelector)) return;
      event.stopPropagation();
      requestClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, isClient, escapeGuardSelector, requestClose]);

  // 移动端：锁滚动 + 初始焦点
  useEffect(() => {
    if (!open || !isClient || !isMobile) return;
    if (lockScroll) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open, isClient, isMobile, lockScroll]);

  useEffect(() => {
    if (!open || !isClient) return;
    closeButtonRef.current?.focus({ preventScroll: true });
  }, [open, isClient]);

  const handleDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isMobile) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select")) return;
    const dialog = dialogRef.current;
    const current = positionRef.current;
    if (!dialog || !current) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: current.left,
      top: current.top,
    };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* 忽略 */
    }
    event.preventDefault();
  };

  const handleDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    const dialog = dialogRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !dialog) return;
    if (event.buttons === 0) {
      handleDragEnd(event);
      return;
    }
    applyPosition(
      clampWindowPosition(
        drag.left + event.clientX - drag.startX,
        drag.top + event.clientY - drag.startY,
        sizeRef.current?.width ?? dialog.offsetWidth,
        sizeRef.current?.height ?? dialog.offsetHeight,
        boundsRef.current,
        mobileQueryRef.current
      )
    );
  };

  const handleDragEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      /* 忽略 */
    }
    if (positionRef.current) saveStoredPosition(positionKey, positionRef.current);
  };

  const handleResizeStart = (event: ReactPointerEvent<HTMLSpanElement>, direction: ResizeDirection) => {
    if (isMobile || event.button !== 0) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (!positionRef.current) applyPosition({ left: rect.left, top: rect.top });
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: sizeRef.current?.width ?? rect.width,
      height: sizeRef.current?.height ?? rect.height,
      direction,
    };
    setResizing(true);

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = null;
    };

    const onMove = (moveEvent: PointerEvent) => {
      const resize = resizeStateRef.current;
      if (!resize || moveEvent.pointerId !== resize.pointerId) return;
      if (moveEvent.buttons === 0) {
        onEnd(moveEvent);
        return;
      }
      const pos = positionRef.current ?? {
        left: boundsRef.current.edgeGap,
        top: boundsRef.current.desktopTop,
      };
      const deltaX = moveEvent.clientX - resize.startX;
      const deltaY = moveEvent.clientY - resize.startY;
      const rawWidth = resize.direction === "s" ? resize.width : resize.width + deltaX;
      const rawHeight = resize.direction === "e" ? resize.height : resize.height + deltaY;
      applySize(clampResizeSize(rawWidth, rawHeight, pos.left, pos.top, boundsRef.current));
      moveEvent.preventDefault();
    };

    const onEnd = (endEvent: PointerEvent) => {
      const resize = resizeStateRef.current;
      if (resize && endEvent.pointerId !== resize.pointerId) return;
      resizeStateRef.current = null;
      setResizing(false);
      cleanup();
      const finalSize = sizeRef.current;
      if (finalSize) saveStoredSize(sizeKey, finalSize);
      const pos = positionRef.current;
      if (finalSize && pos) {
        const nextPosition = clampWindowPosition(
          pos.left,
          pos.top,
          finalSize.width,
          finalSize.height,
          boundsRef.current,
          mobileQueryRef.current
        );
        if (nextPosition.left !== pos.left || nextPosition.top !== pos.top) {
          applyPosition(nextPosition);
          saveStoredPosition(positionKey, nextPosition);
        }
      }
    };

    resizeCleanupRef.current?.();
    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* 忽略 */
    }
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
    },
    []
  );

  if (!isClient || !open) return null;

  const windowStyle: CSSProperties | undefined = isMobile
    ? undefined
    : {
        ...(position ? { left: `${position.left}px`, top: `${position.top}px` } : {}),
        ...(size ? { width: `${size.width}px`, height: `${size.height}px` } : {}),
      };

  return createPortal(
    <>
      {isMobile && <div className={cls.overlay} aria-hidden="true" />}
      <section
        ref={dialogRef}
        className={`${cls.root}${dragging ? " dragging" : ""}${resizing ? " resizing" : ""}${className ? ` ${className}` : ""}`}
        style={windowStyle}
        role="dialog"
        aria-modal={isMobile ? true : undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div
          className={cls.header}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <div className={cls.titleWrap}>
            <span className={cls.title} id={titleId}>
              {title}
            </span>
            {headerExtra}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={cls.close}
            aria-label={closeAriaLabel}
            title={`${closeAriaLabel}（ESC）`}
            onClick={requestClose}
          >
            <i className="fa fa-times" aria-hidden="true"></i>
          </button>
        </div>

        <div className={cls.body}>{children}</div>
        {footer ? <div className={cls.footer}>{footer}</div> : null}

        {!isMobile && (
          <>
            <span
              className={`${cls.resizeHandle} fw-resize-e`}
              aria-hidden="true"
              onPointerDown={(event) => handleResizeStart(event, "e")}
            />
            <span
              className={`${cls.resizeHandle} fw-resize-s`}
              aria-hidden="true"
              onPointerDown={(event) => handleResizeStart(event, "s")}
            />
            <span
              className={`${cls.resizeHandle} fw-resize-se`}
              aria-hidden="true"
              onPointerDown={(event) => handleResizeStart(event, "se")}
            />
          </>
        )}
      </section>
    </>,
    document.body
  );
});

export default FloatingWindow;
