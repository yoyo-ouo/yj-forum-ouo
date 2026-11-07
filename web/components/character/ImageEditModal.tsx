"use client";

// ===== 图片编辑（裁剪）模态框 =====
// 头像固定 1:1；图片支持自由 / 1:1 / 4:3。拖拽平移 + 滚轮/滑杆缩放 + 90° 旋转，
// 确认时从旋转后的 baseCanvas 取裁剪区域，输出 PNG（PNG 源）或 JPEG 0.92。
// 弹窗经 portal 挂到 body，避免被编辑器悬浮窗的 stacking context / z-index 压住。

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/ui/Modal";

export interface ImageEditModalProps {
  /** 用户刚选的本地图片 */
  file: File;
  /** avatar：固定 1:1；image：默认自由比例，可切 1:1 / 4:3 */
  mode: "avatar" | "image";
  /** 上传中：禁用确认并显示「上传中…」 */
  busy?: boolean;
  onConfirm: (cropped: File) => void;
  onCancel: () => void;
}

type RatioKey = "free" | "1:1" | "4:3";

interface Size {
  w: number;
  h: number;
}

const RATIO_OPTIONS: { key: RatioKey; label: string }[] = [
  { key: "free", label: "自由" },
  { key: "1:1", label: "1:1" },
  { key: "4:3", label: "4:3" },
];

/** baseCanvas 长边上限（裁剪输出上限约 2048，保留 2 倍余量） */
const BASE_MAX_EDGE = 4096;
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const CROP_MAX = 240;
const CROP_MAX_NARROW = 200;
const CROP_MIN = 120;

const EMPTY_SUBSCRIBE = () => () => {};

/** 客户端标记：首帧不在服务端渲染，避免 portal 访问 document */
function useIsClient(): boolean {
  return useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    () => true,
    () => false
  );
}

/** 裁剪框边长：常规 240，窄屏 200，同时受舞台尺寸约束 */
function cropLimit(stage: Size, narrow: boolean): number {
  const max = narrow ? CROP_MAX_NARROW : CROP_MAX;
  if (stage.w <= 0 || stage.h <= 0) return max;
  return Math.max(CROP_MIN, Math.min(max, Math.floor(Math.min(stage.w, stage.h) - 48)));
}

/** 按比例在 limit×limit 的方框内换算裁剪框尺寸（自由比例取原图比例） */
function computeCrop(ratio: RatioKey, dims: Size, limit: number): Size {
  const aspect = ratio === "1:1" ? 1 : ratio === "4:3" ? 4 / 3 : dims.w / dims.h;
  if (aspect >= 1) return { w: limit, h: Math.max(1, Math.round(limit / aspect)) };
  return { w: Math.max(1, Math.round(limit * aspect)), h: limit };
}

/** 100%（zoom=1）时图片恰好覆盖裁剪框所需的显示缩放 */
function coverScale(dims: Size, crop: Size, zoom: number): number {
  return Math.max(crop.w / dims.w, crop.h / dims.h) * zoom;
}

/** 图片编辑模态框：本地裁剪后再交给上层上传。 */
export default function ImageEditModal({ file, mode, busy, onConfirm, onCancel }: ImageEditModalProps): ReactNode {
  const [cropBox, setCropBox] = useState<Size>({ w: CROP_MAX, h: CROP_MAX });
  const [ratio, setRatio] = useState<RatioKey>(mode === "avatar" ? "1:1" : "free");
  const [zoomPct, setZoomPct] = useState(100);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const zoomInputId = useId();
  const isClient = useIsClient();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  /** 视图状态：offset 为图片中心相对舞台中心的像素偏移 */
  const viewRef = useRef({ zoom: 1, offsetX: 0, offsetY: 0 });
  const cropRef = useRef<Size>({ w: CROP_MAX, h: CROP_MAX });
  const stageSizeRef = useRef<Size>({ w: 0, h: 0 });
  const ratioRef = useRef<RatioKey>(mode === "avatar" ? "1:1" : "free");
  const rotationRef = useRef(0);
  const narrowRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const wheelCleanupRef = useRef<(() => void) | null>(null);
  /** 取消/卸载后阻止导出回调继续落地 */
  const cancelledRef = useRef(false);
  /** 重绘合帧（pointermove/wheel 高频触发） */
  const rafRef = useRef(0);

  /** 把 baseCanvas 按当前平移/缩放画到预览 canvas（合帧：每帧最多绘一次） */
  const drawNow = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    const stage = stageSizeRef.current;
    if (!canvas || !base || stage.w <= 0 || stage.h <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.max(1, Math.round(stage.w * dpr));
    const pxH = Math.max(1, Math.round(stage.h * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const view = viewRef.current;
    const scale = coverScale({ w: base.width, h: base.height }, cropRef.current, view.zoom);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.w, stage.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(stage.w / 2 + view.offsetX, stage.h / 2 + view.offsetY);
    ctx.scale(scale, scale);
    ctx.drawImage(base, -base.width / 2, -base.height / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  const drawPreview = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      drawNow();
    });
  }, [drawNow]);

  /** 平移限制：裁剪框必须始终被图片覆盖 */
  const clampView = useCallback(() => {
    const base = baseRef.current;
    if (!base) return;
    const crop = cropRef.current;
    const scale = coverScale({ w: base.width, h: base.height }, crop, viewRef.current.zoom);
    const maxX = Math.max(0, (base.width * scale - crop.w) / 2);
    const maxY = Math.max(0, (base.height * scale - crop.h) / 2);
    const view = viewRef.current;
    view.offsetX = Math.min(maxX, Math.max(-maxX, view.offsetX));
    view.offsetY = Math.min(maxY, Math.max(-maxY, view.offsetY));
  }, []);

  /** 重新计算裁剪框尺寸并重绘 */
  const refreshCrop = useCallback(
    (dims?: Size) => {
      const base = baseRef.current;
      const size = dims ?? (base ? { w: base.width, h: base.height } : null);
      if (!size) return;
      const crop = computeCrop(ratioRef.current, size, cropLimit(stageSizeRef.current, narrowRef.current));
      cropRef.current = crop;
      setCropBox(crop);
      clampView();
      drawPreview();
    },
    [clampView, drawPreview]
  );

  /** 生成应用了旋转的 baseCanvas，返回其尺寸 */
  const buildBase = useCallback((deg: number): Size | null => {
    const img = imageRef.current;
    if (!img) return null;
    const swap = deg % 180 !== 0;
    const rawW = swap ? img.naturalHeight : img.naturalWidth;
    const rawH = swap ? img.naturalWidth : img.naturalHeight;
    if (!rawW || !rawH) return null;
    const factor = Math.min(1, BASE_MAX_EDGE / Math.max(rawW, rawH));
    const w = Math.max(1, Math.round(rawW * factor));
    const h = Math.max(1, Math.round(rawH * factor));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(w / 2, h / 2);
    ctx.rotate((deg * Math.PI) / 180);
    const drawW = img.naturalWidth * factor;
    const drawH = img.naturalHeight * factor;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    baseRef.current = canvas;
    return { w, h };
  }, []);

  /** 重置平移与缩放（100%） */
  const resetView = useCallback(() => {
    viewRef.current = { zoom: 1, offsetX: 0, offsetY: 0 };
    setZoomPct(100);
  }, []);

  /** 缩放时保持裁剪框中心对应的画面位置不变 */
  const applyZoom = useCallback(
    (next: number) => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      const prev = viewRef.current.zoom;
      if (Math.abs(zoom - prev) < 0.001) return;
      const k = zoom / prev;
      viewRef.current.zoom = zoom;
      viewRef.current.offsetX *= k;
      viewRef.current.offsetY *= k;
      clampView();
      setZoomPct(Math.round(zoom * 100));
      drawPreview();
    },
    [clampView, drawPreview]
  );

  const releaseResources = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    wheelCleanupRef.current?.();
    wheelCleanupRef.current = null;
    const url = objectUrlRef.current;
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlRef.current = null;
    }
  }, []);

  // 加载本地图片 → 建 baseCanvas（首次）
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      const dims = buildBase(rotationRef.current);
      if (!dims) {
        setLoading(false);
        setError("图片加载失败，请重新选择图片");
        return;
      }
      setLoading(false);
      setReady(true);
      refreshCrop(dims);
    };
    img.onerror = () => {
      if (cancelled) return;
      setLoading(false);
      setError("图片加载失败，请重新选择图片");
    };
    img.src = url;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(url);
      if (objectUrlRef.current === url) objectUrlRef.current = null;
    };
  }, [file, buildBase, refreshCrop]);

  // 窄屏（<720px）裁剪框缩到 200
  useEffect(() => {
    const query = window.matchMedia("(max-width: 719.98px)");
    narrowRef.current = query.matches;
    const onChange = () => {
      narrowRef.current = query.matches;
      refreshCrop();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [refreshCrop]);

  // 舞台尺寸跟踪（缩放/响应式变化后重新夹取平移范围）
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const next = rect ? { w: rect.width, h: rect.height } : { w: stage.clientWidth, h: stage.clientHeight };
      const prev = stageSizeRef.current;
      if (Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5) return;
      stageSizeRef.current = next;
      refreshCrop();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [refreshCrop, isClient]);

  // 滚轮缩放：非 passive，阻止页面滚动
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // 归一化 deltaMode：Firefox 按行返回（deltaMode=1），不做换算几乎无法缩放
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      applyZoom(viewRef.current.zoom * Math.exp(-event.deltaY * unit * 0.0015));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    const cleanup = () => stage.removeEventListener("wheel", onWheel);
    wheelCleanupRef.current = cleanup;
    return () => {
      cleanup();
      if (wheelCleanupRef.current === cleanup) wheelCleanupRef.current = null;
    };
  }, [applyZoom, isClient]);

  // 卸载兜底：解绑拖拽监听、释放 objectURL
  useEffect(() => releaseResources, [releaseResources]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !baseRef.current) return;
    dragCleanupRef.current?.();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startOffsetX = viewRef.current.offsetX;
    const startOffsetY = viewRef.current.offsetY;

    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    }
    function onMove(move: PointerEvent) {
      if (move.pointerId !== pointerId) return;
      // 丢失 pointerup（系统弹窗/失焦）时兜底结束拖拽
      if (move.buttons === 0) {
        onEnd();
        return;
      }
      viewRef.current.offsetX = startOffsetX + (move.clientX - startX);
      viewRef.current.offsetY = startOffsetY + (move.clientY - startY);
      clampView();
      drawPreview();
    }
    function onEnd() {
      cleanup();
      setDragging(false);
    }

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    setDragging(true);
    event.preventDefault();
  };

  const handleRatio = (key: RatioKey) => {
    if (mode === "avatar" && key !== "1:1") return;
    ratioRef.current = key;
    setRatio(key);
    resetView();
    refreshCrop();
  };

  const handleRotate = (delta: number) => {
    rotationRef.current = (rotationRef.current + delta + 360) % 360;
    const dims = buildBase(rotationRef.current);
    resetView();
    if (dims) refreshCrop(dims);
  };

  const handleReset = () => {
    rotationRef.current = 0;
    ratioRef.current = mode === "avatar" ? "1:1" : "free";
    setRatio(ratioRef.current);
    resetView();
    const dims = buildBase(0);
    if (dims) refreshCrop(dims);
  };

  const handleCancel = () => {
    // 处理中/上传中不允许取消：避免导出回调在弹窗卸载后仍写入草稿
    if (busy || exporting) return;
    cancelledRef.current = true;
    setDragging(false);
    releaseResources();
    onCancel();
  };

  const handleConfirm = async () => {
    const base = baseRef.current;
    if (!base || busy || exporting) return;
    const crop = cropRef.current;
    const view = viewRef.current;
    const scale = coverScale({ w: base.width, h: base.height }, crop, view.zoom);
    const sw = crop.w / scale;
    const sh = crop.h / scale;
    const sx = ((base.width * scale - crop.w) / 2 - view.offsetX) / scale;
    const sy = ((base.height * scale - crop.h) / 2 - view.offsetY) / scale;
    // 长边上限：头像 800，普通图片 2048；不放大
    const maxEdge = mode === "avatar" ? 800 : 2048;
    const outScale = Math.min(1, maxEdge / Math.max(sw, sh));
    const outW = Math.max(1, Math.round(sw * outScale));
    const outH = Math.max(1, Math.round(sh * outScale));
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext("2d");
    if (!ctx) {
      setError("裁剪失败，请重试");
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const sxSafe = Math.min(Math.max(0, sx), Math.max(0, base.width - sw));
    const sySafe = Math.min(Math.max(0, sy), Math.max(0, base.height - sh));
    ctx.drawImage(base, sxSafe, sySafe, sw, sh, 0, 0, outW, outH);

    const png = (() => {
      // 抽样检测 alpha：透明图（PNG/WebP/GIF）走 PNG，否则 JPEG 更小
      try {
        const probe = out.getContext("2d");
        if (!probe) return file.type.toLowerCase() === "image/png";
        const data = probe.getImageData(0, 0, outW, outH).data;
        const step = 4 * 97;
        for (let i = 3; i < data.length; i += step) {
          if (data[i] < 250) return true;
        }
        return false;
      } catch {
        return file.type.toLowerCase() === "image/png";
      }
    })();
    const mime = png ? "image/png" : "image/jpeg";
    setExporting(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        out.toBlob((result) => resolve(result), mime, png ? undefined : 0.92);
      });
      if (!blob) {
        setError("裁剪失败，请重试");
        return;
      }
      if (cancelledRef.current) return;
      const ext = png ? "png" : "jpg";
      onConfirm(new File([blob], `character-${mode}-${Date.now()}.${ext}`, { type: mime }));
    } catch {
      if (!cancelledRef.current) setError("裁剪失败，请重试");
    } finally {
      if (!cancelledRef.current) setExporting(false);
    }
  };

  const modal = (
    <Modal
      open
      onClose={handleCancel}
      className="ie-modal"
      overlayClassName="ie-overlay"
      cardClassName="ie-card"
      closeClassName="ie-close"
      lockScroll
    >
      <h3 className="ie-title">
        <i className={`fa ${mode === "avatar" ? "fa-user-circle" : "fa-image"}`} aria-hidden="true"></i>
        {mode === "avatar" ? "编辑头像" : "编辑图片"}
      </h3>
      <p className="ie-subtitle">拖动图片调整位置，滚轮或滑杆缩放，确认后上传裁剪结果。</p>

      <div className="ie-body">
        <div
          className={`ie-stage${dragging ? " is-dragging" : ""}`}
          ref={stageRef}
          role="img"
          aria-label="裁剪预览"
          onPointerDown={handlePointerDown}
        >
          <canvas ref={canvasRef} className="ie-canvas" aria-hidden="true"></canvas>
          <div className="ie-crop-frame" style={{ width: cropBox.w, height: cropBox.h }} aria-hidden="true"></div>
          <span className="ie-stage-tip" aria-hidden="true">拖动平移 · 滚轮缩放</span>
          {loading && <div className="ie-stage-loading">图片加载中…</div>}
        </div>

        <div className="ie-side">
          <div className="ie-field">
            <span className="ie-label">裁剪比例</span>
            <div className="ie-ratios" role="group" aria-label="裁剪比例">
              {RATIO_OPTIONS.map((opt) => {
                const disabled = mode === "avatar" && opt.key !== "1:1";
                return (
                  <button
                    key={opt.key}
                    type="button"
                    className={`ie-ratio-btn${ratio === opt.key ? " is-active" : ""}`}
                    aria-label={`裁剪比例 ${opt.label}`}
                    aria-pressed={ratio === opt.key}
                    disabled={disabled}
                    title={disabled ? "头像固定为 1:1" : undefined}
                    onClick={() => handleRatio(opt.key)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ie-field">
            <label className="ie-label" htmlFor={zoomInputId}>
              缩放
              <span className="ie-label-value">{zoomPct}%</span>
            </label>
            <input
              id={zoomInputId}
              className="ie-range"
              type="range"
              min={ZOOM_MIN * 100}
              max={ZOOM_MAX * 100}
              step={1}
              value={zoomPct}
              aria-label="缩放比例"
              onChange={(event) => applyZoom(Number(event.target.value) / 100)}
            />
          </div>

          <div className="ie-field">
            <span className="ie-label">旋转与重置</span>
            <div className="ie-tools">
              <button type="button" className="ie-tool" aria-label="向左旋转 90 度" onClick={() => handleRotate(-90)}>
                <i className="fa fa-undo" aria-hidden="true"></i> 左转
              </button>
              <button type="button" className="ie-tool" aria-label="向右旋转 90 度" onClick={() => handleRotate(90)}>
                <i className="fa fa-repeat" aria-hidden="true"></i> 右转
              </button>
            </div>
            <button type="button" className="ie-tool ie-tool-block" aria-label="重置裁剪调整" onClick={handleReset}>
              <i className="fa fa-refresh" aria-hidden="true"></i> 重置
            </button>
          </div>

          <p className="ie-note">
            {mode === "avatar" ? "头像会裁剪为 1:1 方形。" : "自由比例保留原图比例，也可切换 1:1 / 4:3。"}
          </p>
        </div>
      </div>

      {error && (
        <p className="ie-error" role="alert">
          {error}
        </p>
      )}

      <div className="ie-actions">
        <button type="button" className="ie-btn ie-btn-ghost" onClick={handleCancel} disabled={exporting || !!busy}>
          取消
        </button>
        <button
          type="button"
          className="ie-btn ie-btn-primary"
          onClick={() => void handleConfirm()}
          disabled={!!busy || exporting || !ready}
        >
          {busy ? "上传中…" : exporting ? "处理中…" : "确定"}
        </button>
      </div>
    </Modal>
  );

  if (!isClient) return null;
  return createPortal(modal, document.body);
}
