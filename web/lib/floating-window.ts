"use client";

// ===== 悬浮窗数学与存储（世界频道 / 角色设定共用）=====
// 窗口位置与尺寸的 clamp、localStorage 记忆、断点判定。
// 只包含纯函数与存储访问，不依赖 React；拖拽/缩放状态机留在各组件内。

export interface WindowPosition {
  left: number;
  top: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface FloatingBounds {
  /** 视口边缘留白 */
  edgeGap: number;
  /** 桌面端窗口顶部下限（Header 高度 + 间距） */
  desktopTop: number;
  /** 桌面默认/最小尺寸 */
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  /** 极端小视口兜底下限 */
  minRenderSize: number;
}

export const DEFAULT_FLOATING_BOUNDS: FloatingBounds = {
  edgeGap: 8,
  desktopTop: 86,
  defaultWidth: 408,
  defaultHeight: 620,
  minWidth: 340,
  minHeight: 420,
  minRenderSize: 240,
};

export const MOBILE_MEDIA_QUERY = "(max-width: 700px)";

export function isMobileViewport(query: string = MOBILE_MEDIA_QUERY): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

export function readStoredPosition(key: string): WindowPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WindowPosition> | null;
    if (!parsed || typeof parsed.left !== "number" || typeof parsed.top !== "number") return null;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

export function saveStoredPosition(key: string, position: WindowPosition): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(position));
  } catch {
    /* 隐私模式/配额不足时忽略 */
  }
}

export function readStoredSize(key: string): WindowSize | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WindowSize> | null;
    if (!parsed || typeof parsed.width !== "number" || typeof parsed.height !== "number") return null;
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null;
    return { width: parsed.width, height: parsed.height };
  } catch {
    return null;
  }
}

export function saveStoredSize(key: string, size: WindowSize): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(size));
  } catch {
    /* 隐私模式/配额不足时忽略 */
  }
}

/** 当前视口允许的窗口尺寸区间（最大不超过视口减边距） */
export function getSizeLimits(bounds: FloatingBounds = DEFAULT_FLOATING_BOUNDS) {
  const vw = typeof window === "undefined" ? bounds.defaultWidth : window.innerWidth;
  const vh = typeof window === "undefined" ? bounds.defaultHeight : window.innerHeight;
  const maxWidth = Math.max(bounds.minRenderSize, vw - bounds.edgeGap * 2);
  const maxHeight = Math.max(bounds.minRenderSize, vh - bounds.desktopTop - bounds.edgeGap);
  return {
    minWidth: Math.min(bounds.minWidth, maxWidth),
    minHeight: Math.min(bounds.minHeight, maxHeight),
    maxWidth,
    maxHeight,
  };
}

/** 按视口边界 clamp 尺寸（打开时读取 localStorage 后使用） */
export function clampWindowSize(
  width: number,
  height: number,
  bounds: FloatingBounds = DEFAULT_FLOATING_BOUNDS
): WindowSize {
  const limits = getSizeLimits(bounds);
  return {
    width: Math.round(Math.min(Math.max(width, limits.minWidth), limits.maxWidth)),
    height: Math.round(Math.min(Math.max(height, limits.minHeight), limits.maxHeight)),
  };
}

/** 拖拽 resize：除视口上限外，还保证右/下边缘不越界（左上角锚定） */
export function clampResizeSize(
  width: number,
  height: number,
  left: number,
  top: number,
  bounds: FloatingBounds = DEFAULT_FLOATING_BOUNDS
): WindowSize {
  const limits = getSizeLimits(bounds);
  const availableWidth = Math.max(
    limits.minWidth,
    window.innerWidth - Math.max(left, bounds.edgeGap) - bounds.edgeGap
  );
  const availableHeight = Math.max(
    limits.minHeight,
    window.innerHeight - Math.max(top, bounds.desktopTop) - bounds.edgeGap
  );
  return {
    width: Math.round(Math.min(Math.max(width, limits.minWidth), Math.min(limits.maxWidth, availableWidth))),
    height: Math.round(Math.min(Math.max(height, limits.minHeight), Math.min(limits.maxHeight, availableHeight))),
  };
}

/** 边界 clamp：窗口始终完整留在视口内（桌面 top 不低于 Header 下方间距） */
export function clampWindowPosition(
  left: number,
  top: number,
  width: number,
  height: number,
  bounds: FloatingBounds = DEFAULT_FLOATING_BOUNDS,
  mobileQuery: string = MOBILE_MEDIA_QUERY
): WindowPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const minTop = isMobileViewport(mobileQuery) ? bounds.edgeGap : bounds.desktopTop;
  const maxLeft = Math.max(bounds.edgeGap, vw - width - bounds.edgeGap);
  const maxTop = Math.max(minTop, vh - height - bounds.edgeGap);
  return {
    left: Math.min(Math.max(left, bounds.edgeGap), maxLeft),
    top: Math.min(Math.max(top, minTop), maxTop),
  };
}
