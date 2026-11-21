"use client";

// ===== 批量添加：强制 3 秒确认模态框 =====
// - 只有模态框真正展示后才开始计时；关闭后重新打开会重新计时；
// - 页面切到后台时暂停计时（visibilitychange 重置计时基准），返回后继续；
// - 服务端另有 3 秒校验，前端倒计时只是体验保障。

import { useEffect, useState } from "react";
import CharacterBatchCard from "./CharacterBatchCard";
import type { CharacterBatchItem, CharacterQuota } from "@/lib/api/character";

const WAIT_MS = 3000;

export interface CharacterBatchConfirmModalProps {
  open: boolean;
  items: CharacterBatchItem[];
  quota: CharacterQuota;
  submitting: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}

export default function CharacterBatchConfirmModal({
  open,
  items,
  quota,
  submitting,
  error,
  onClose,
  onConfirm,
}: CharacterBatchConfirmModalProps) {
  const [elapsed, setElapsed] = useState(0);

  // 倒计时：只在可见时段累加，切后台不扣时间。
  // 每次打开时由父组件用 key 重新挂载，elapsed 自然从 0 开始。
  useEffect(() => {
    if (!open) return;
    let acc = 0;
    let last = Date.now();
    const onVisibility = () => {
      last = Date.now();
    };
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (!document.hidden) acc += now - last;
      last = now;
      setElapsed(acc);
    }, 100);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open]);

  // Esc 关闭 + 锁背景滚动
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, submitting, onClose]);

  if (!open) return null;

  const remainMs = Math.max(0, WAIT_MS - elapsed);
  const ready = remainMs <= 0;
  const count = items.length;
  const after = quota.remaining - count;

  return (
    <div className="cb-modal-mask" role="presentation">
      <div className="cb-modal" role="dialog" aria-modal="true" aria-labelledby="cb-modal-title">
        <header className="cb-modal-head">
          <div>
            <h2 id="cb-modal-title">确认批量添加</h2>
            <p>
              本次将创建 <b>{count}</b> 个角色草稿，不会发布，也不会设置会馆。
            </p>
          </div>
          <button
            type="button"
            className="cb-modal-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭"
          >
            <i className="fa fa-times" aria-hidden="true"></i>
          </button>
        </header>

        <div className="cb-modal-summary">
          <span>剩余配额：<b>{quota.remaining}</b> 个</span>
          <span>创建后剩余：<b className={after < 0 ? "is-bad" : ""}>{after}</b> 个</span>
          <span>角色总数上限：<b>{quota.max}</b></span>
        </div>

        <div className="cb-modal-body">
          {items.map((item) => (
            <CharacterBatchCard key={`${item.identifier}-${item.line}`} item={item} />
          ))}
        </div>

        {error ? (
          <p className="cb-modal-error" role="alert">
            <i className="fa fa-exclamation-triangle" aria-hidden="true"></i> {error}
          </p>
        ) : null}

        <footer className="cb-modal-foot">
          <p className="cb-modal-hint">
            <i className="fa fa-clock-o" aria-hidden="true"></i>
            {ready
              ? "请确认上面的内容与你的原意一致。"
              : "为防误操作，请先阅读一遍本次解析结果。"}
          </p>
          <div className="cb-modal-actions">
            <button type="button" className="cb-btn cb-btn-ghost" onClick={onClose} disabled={submitting}>
              返回修改
            </button>
            <button
              type="button"
              className="cb-btn cb-btn-primary"
              onClick={onConfirm}
              disabled={!ready || submitting || after < 0}
              aria-live="polite"
            >
              {submitting ? (
                <>
                  <i className="fa fa-spinner fa-spin" aria-hidden="true"></i> 正在创建…
                </>
              ) : ready ? (
                `确认创建 ${count} 个角色`
              ) : (
                `请阅读（${Math.ceil(remainMs / 1000)} 秒）`
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
