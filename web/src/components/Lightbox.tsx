import React, { useEffect, useMemo, useRef, useState } from "react";
import { registerBackHandler } from "../lib/back";
import { mediaUrl } from "../lib/native";
import { Icon } from "./icons";

export interface LightboxProps {
  /** 站内图片地址（相对地址会经 mediaUrl 归一）：只接受站内图片，不接外部 iframe/视频 */
  images: string[];
  /** 初始下标 */
  index?: number;
  onClose: () => void;
}

const MAX_ZOOM = 3;
const SWIPE_THRESHOLD = 48;
const DOUBLE_TAP_MS = 300;

function clampIndex(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, value));
}

function clampScale(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(1, value));
}

/** 全屏图片查看：左右切换 + 双击缩放（保留拖拽平移）+ 返回键关闭 */
export function Lightbox({ images, index = 0, onClose }: LightboxProps) {
  const urls = useMemo(() => images.map((item) => mediaUrl(item)).filter(Boolean), [images]);
  const [current, setCurrent] = useState(() => clampIndex(index, urls.length));
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef({
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    pinchDistance: 0,
    pinchScale: 1,
    lastTap: 0,
    moved: false,
    /** 本次手势是否出现过双指（双指后不再判定滑动/双击） */
    multi: false,
  });
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => registerBackHandler(() => {
    onClose();
    return true;
  }), [onClose]);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [current]);

  const maxOffset = (zoom: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (rect.width * (zoom - 1)) / 2, y: (rect.height * (zoom - 1)) / 2 };
  };

  const applyOffset = (next: { x: number; y: number }, zoom: number) => {
    const max = maxOffset(zoom);
    setOffset({ x: Math.min(max.x, Math.max(-max.x, next.x)), y: Math.min(max.y, Math.max(-max.y, next.y)) });
  };

  const zoomTo = (next: number) => {
    const zoom = clampScale(next);
    setScale(zoom);
    if (zoom === 1) setOffset({ x: 0, y: 0 });
    else applyOffset(offset, zoom);
  };

  const step = (delta: number) => {
    if (urls.length <= 1) return;
    setCurrent((value) => (value + delta + urls.length) % urls.length);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = gesture.current;
    state.moved = false;
    if (pointers.current.size === 1) {
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.startOffsetX = offset.x;
      state.startOffsetY = offset.y;
      state.multi = false;
    } else if (pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values());
      state.pinchDistance = Math.hypot(second.x - first.x, second.y - first.y);
      state.pinchScale = scale;
      state.multi = true;
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = gesture.current;
    if (pointers.current.size === 2 && state.pinchDistance > 0) {
      const [first, second] = Array.from(pointers.current.values());
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      setScale(clampScale((state.pinchScale * distance) / state.pinchDistance));
      state.moved = true;
      return;
    }
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) state.moved = true;
    if (scale > 1) applyOffset({ x: state.startOffsetX + dx, y: state.startOffsetY + dy }, scale);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = gesture.current;
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) state.pinchDistance = 0;
    if (state.multi) {
      if (pointers.current.size === 0) state.multi = false;
      return;
    }
    if (!wasSingle) return;
    const dx = event.clientX - state.startX;
    if (scale <= 1 && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(event.clientY - state.startY)) {
      step(dx < 0 ? 1 : -1);
      state.moved = true;
      return;
    }
    if (!state.moved) {
      const now = Date.now();
      if (now - state.lastTap < DOUBLE_TAP_MS) {
        zoomTo(scale > 1 ? 1 : 2.2);
        state.lastTap = 0;
      } else {
        state.lastTap = now;
      }
    }
  };

  if (urls.length === 0) return null;
  const url = urls[current];

  return (
    <div className="lb-mask" role="dialog" aria-modal="true" aria-label="查看图片" onClick={onClose}>
      <div className="lb-head" onClick={(event) => event.stopPropagation()}>
        {urls.length > 1 ? <span className="lb-count">{current + 1} / {urls.length}</span> : <span />}
        <button className="lb-btn" aria-label="关闭" onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
      </div>
      <div
        ref={stageRef}
        className="lb-stage"
        onClick={(event) => {
          event.stopPropagation();
          // 点图片外的空白处关闭（图片本身不响应点击）
          if (event.target === event.currentTarget) onClose();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => zoomTo(scale > 1 ? 1 : 2.2)}
      >
        <img
          className="lb-img"
          src={url}
          alt=""
          draggable={false}
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }}
        />
      </div>
      {urls.length > 1 ? (
        <>
          <button
            className="lb-nav lb-nav--prev"
            aria-label="上一张"
            onClick={(event) => { event.stopPropagation(); step(-1); }}
          >
            <Icon name="back" size={24} />
          </button>
          <button
            className="lb-nav lb-nav--next"
            aria-label="下一张"
            onClick={(event) => { event.stopPropagation(); step(1); }}
          >
            <Icon name="forward" size={24} />
          </button>
        </>
      ) : null}
    </div>
  );
}
