import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { registerBackHandler } from "../lib/back";
import { fetchMedia, fileSrc } from "../lib/native";
import { Icon } from "./icons";

export interface ImageCropProps {
  /** 待裁剪图片：File / data URL / blob URL / 原生文件路径 / 站内地址 */
  file: File | string;
  /** avatar：强制 1:1；image：自由 / 1:1 / 4:3 可选 */
  mode: "avatar" | "image";
  /** 输出 data URL（PNG 源保持 PNG，其余为 JPEG 0.92） */
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}

type RatioKey = "free" | "square" | "four-three";

const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.92;
const MAX_ZOOM = 4;
const MIN_ZOOM = 1;
const FRAME_GAP = 18;

const RATIOS: Array<{ key: RatioKey; label: string }> = [
  { key: "free", label: "原图" },
  { key: "square", label: "1:1" },
  { key: "four-three", label: "4:3" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = src;
  });
}

function mimeFromDataUrl(src: string): string {
  const match = /^data:([^;,]+)/.exec(src);
  return match?.[1] || "";
}

/** 从 data URL / 文件路径猜 MIME（原生相册返回的文件名带扩展名）。 */
function mimeFromPath(src: string): string {
  if (src.startsWith("data:")) return mimeFromDataUrl(src);
  const clean = src.split("?")[0].toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

/** 把各种输入统一成可放进 <img> 的地址（站外地址先落到本地/data，避开 canvas 污染）。 */
async function resolveSource(input: string): Promise<string> {
  if (input.startsWith("data:") || input.startsWith("blob:")) return input;
  if (/^https?:/.test(input)) return await fetchMedia(input).catch(() => input);
  return fileSrc(input);
}

/** canvas 裁剪：拖拽平移 / 双指或滑杆缩放 / 90° 旋转 / 最长边 2048 下采样 */
export function ImageCrop({ file, mode, onConfirm, onCancel }: ImageCropProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageMime, setImageMime] = useState("image/jpeg");
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ratio, setRatio] = useState<RatioKey>(mode === "avatar" ? "square" : "free");
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ startX: 0, startY: 0, offsetX: 0, offsetY: 0, distance: 0, zoom: 1 });

  useEffect(() => registerBackHandler(() => {
    onCancel();
    return true;
  }), [onCancel]);

  // 读图：File 用 objectURL，其余按 data/blob/http/本地路径分别处理
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const run = async () => {
      try {
        let src: string;
        let mime = "";
        if (typeof file === "string") {
          src = await resolveSource(file);
          mime = mimeFromPath(src) || mimeFromPath(file);
        } else {
          mime = file.type || mimeFromPath(file.name);
          objectUrl = URL.createObjectURL(file);
          src = objectUrl;
        }
        const img = await loadImage(src);
        if (cancelled) return;
        setImage(img);
        setImageMime(mime || "image/jpeg");
        setRotation(0);
        setZoom(MIN_ZOOM);
        setOffset({ x: 0, y: 0 });
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "图片读取失败");
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => setContainerWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 旋转后的宽高比：自由模式跟随图片，其余固定
  const imageAspect = useMemo(() => {
    if (!image) return 1;
    const wide = image.naturalWidth || 1;
    const tall = image.naturalHeight || 1;
    return rotation % 180 === 0 ? wide / tall : tall / wide;
  }, [image, rotation]);

  const frameAspect = mode === "avatar"
    ? 1
    : ratio === "square"
      ? 1
      : ratio === "four-three"
        ? 4 / 3
        : imageAspect;

  // 裁剪框尺寸：宽度吃清容器，高度受视口限制
  const viewport = useMemo(() => {
    const maxWidth = Math.max(120, containerWidth - FRAME_GAP * 2);
    const maxHeight = Math.min(Math.max(180, window.innerHeight * 0.5), maxWidth * 1.6);
    let width = maxWidth;
    let height = width / frameAspect;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * frameAspect;
    }
    return { w: Math.round(width), h: Math.round(height) };
  }, [containerWidth, frameAspect]);

  /** 旋转后的图片在屏幕上的基准尺寸（cover） */
  const geometry = useMemo(() => {
    if (!image) return { drawW: 0, drawH: 0, base: 1 };
    const rotatedW = rotation % 180 === 0 ? image.naturalWidth : image.naturalHeight;
    const rotatedH = rotation % 180 === 0 ? image.naturalHeight : image.naturalWidth;
    const base = Math.max(viewport.w / rotatedW, viewport.h / rotatedH);
    const scale = base * zoom;
    return { drawW: rotatedW * scale, drawH: rotatedH * scale, base };
  }, [image, rotation, viewport, zoom]);

  const clampOffset = (next: { x: number; y: number }, ratioZoom = zoom) => {
    if (!image) return next;
    const rotatedW = rotation % 180 === 0 ? image.naturalWidth : image.naturalHeight;
    const rotatedH = rotation % 180 === 0 ? image.naturalHeight : image.naturalWidth;
    const base = Math.max(viewport.w / rotatedW, viewport.h / rotatedH) * ratioZoom;
    const maxX = Math.max(0, (rotatedW * base - viewport.w) / 2);
    const maxY = Math.max(0, (rotatedH * base - viewport.h) / 2);
    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  };

  // 缩放 / 旋转 / 尺寸变化后把位移拉回边界（否则会露出空白）
  useEffect(() => {
    setOffset((current) => {
      const next = clampOffset(current);
      return next.x === current.x && next.y === current.y ? current : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, rotation, viewport.w, viewport.h, image]);

  const draw = (ctx: CanvasRenderingContext2D, width: number, height: number, outScale: number) => {
    if (!image) return;
    const drawW = geometry.drawW * outScale;
    const drawH = geometry.drawH * outScale;
    ctx.save();
    ctx.translate(width / 2 + offset.x * outScale, height / 2 + offset.y * outScale);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  };

  // 预览：canvas 与裁剪框同尺寸（按 dpr 提清）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || viewport.w < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewport.w * dpr);
    canvas.height = Math.round(viewport.h * dpr);
    canvas.style.width = `${viewport.w}px`;
    canvas.style.height = `${viewport.h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, canvas.width, canvas.height, dpr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, rotation, zoom, offset, viewport, geometry]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = gesture.current;
    if (pointers.current.size === 1) {
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.offsetX = offset.x;
      state.offsetY = offset.y;
    } else if (pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values());
      state.distance = Math.hypot(second.x - first.x, second.y - first.y);
      state.zoom = zoom;
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = gesture.current;
    if (pointers.current.size === 2 && state.distance > 0) {
      const [first, second] = Array.from(pointers.current.values());
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      setZoom(clamp((state.zoom * distance) / state.distance, MIN_ZOOM, MAX_ZOOM));
      return;
    }
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    setOffset(clampOffset({ x: state.offsetX + dx, y: state.offsetY + dy }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current.distance = 0;
  };

  const rotate = () => setRotation((value) => (value + 90) % 360);

  const confirm = () => {
    if (!image) return;
    const visibleSourceWidth = viewport.w / (geometry.base * zoom);
    const visibleSourceHeight = viewport.h / (geometry.base * zoom);
    const outW = Math.max(1, Math.min(MAX_EDGE, Math.round(visibleSourceWidth)));
    const outH = Math.max(1, Math.min(MAX_EDGE, Math.round(visibleSourceHeight)));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const keepAlpha = imageMime === "image/png";
    if (!keepAlpha) {
      ctx.fillStyle = "#202A29";
      ctx.fillRect(0, 0, outW, outH);
    }
    draw(ctx, outW, outH, outW / viewport.w);
    try {
      onConfirm(canvas.toDataURL(keepAlpha ? "image/png" : "image/jpeg", keepAlpha ? undefined : JPEG_QUALITY));
    } catch {
      setError("图片处理失败，请换一张试试");
    }
  };

  return (
    <div className="ic-mask" role="dialog" aria-modal="true" aria-label="裁剪图片">
      <div className="ic-panel">
        <div className="ic-head">
          <button className="ic-iconbtn" aria-label="取消" onClick={onCancel}>
            <Icon name="close" size={20} />
          </button>
          <strong className="ic-title">{mode === "avatar" ? "调整头像" : "调整图片"}</strong>
          <button className="ic-iconbtn" aria-label="旋转 90 度" onClick={rotate}>
            <Icon name="rotate" size={20} />
          </button>
        </div>

        <div className="ic-body" ref={containerRef}>
          <div className="ic-stage" style={{ width: viewport.w, height: viewport.h }}>
            <canvas
              ref={canvasRef}
              className="ic-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <div className="ic-grid" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
            {!image && !error ? <span className="m-spinner ic-loading" /> : null}
          </div>
        </div>

        {mode === "image" ? (
          <div className="ic-ratios">
            {RATIOS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`ic-ratio ${ratio === item.key ? "on" : ""}`.trim()}
                onClick={() => setRatio(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ic-zoom">
          <span className="ic-zoom-label">缩放</span>
          <input
            className="ic-slider"
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            aria-label="缩放"
            onChange={(event) => setZoom(clamp(Number(event.target.value), MIN_ZOOM, MAX_ZOOM))}
          />
          <span className="ic-zoom-value">{zoom.toFixed(1)}×</span>
        </div>

        {error ? <div className="ic-error"><Icon name="alert" size={15} />{error}</div> : null}

        <div className="ic-foot">
          <button className="m-btn m-btn--ghost" onClick={onCancel}>取消</button>
          <button className="m-btn m-btn--primary" onClick={confirm} disabled={!image}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
