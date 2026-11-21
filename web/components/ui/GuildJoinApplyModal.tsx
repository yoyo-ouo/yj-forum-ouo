"use client";

import { useEffect, useRef } from "react";
import Modal from "./Modal";

/** 申请理由上限（与后端 rune 计数口径一致：按码点而非 UTF-16 code unit） */
export const GUILD_APPLY_REASON_MAX = 500;

/** 按码点计数，emoji 不会被算成两个字 */
export function guildApplyReasonLength(value: string): number {
  return Array.from(value).length;
}

/** 按码点截断到上限 */
export function clampGuildApplyReason(value: string): string {
  return Array.from(value).slice(0, GUILD_APPLY_REASON_MAX).join("");
}

/**
 * 入馆申请理由弹窗（可选填写，≤500 字）。
 * 草稿由页面持有：关闭不清空、提交成功或切换会馆时由页面清空。
 */
export default function GuildJoinApplyModal({
  open,
  guildName,
  reason,
  busy,
  onReasonChange,
  onSubmit,
  onClose,
}: {
  open: boolean;
  guildName: string;
  reason: string;
  busy?: boolean;
  onReasonChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 每次打开自动聚焦输入框（Modal 关闭时整棵子树卸载，autoFocus 也能生效，但显式聚焦更稳）
  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const count = guildApplyReasonLength(reason);
  const nearLimit = count >= GUILD_APPLY_REASON_MAX - 50;
  const close = () => {
    if (!busy) onClose();
  };
  const submit = () => {
    if (!busy) onSubmit();
  };

  return (
    <Modal open={open} onClose={close} cardStyle={{ maxWidth: 460 }} lockScroll closeable={!busy}>
      <h3 className="donate-title">
        <i className="fa fa-paper-plane"></i> 申请加入「{guildName}」
      </h3>
      <p className="guild-apply-note">理由会展示给馆长，建议简单说明你想加入的原因（可选）。</p>
      <p className="guild-apply-note">同一时间只能申请一个会馆，提交后需等待审核或撤回。</p>

      <div className="guild-apply-field">
        <label className="guild-apply-label" htmlFor="guild-apply-reason">
          申请理由
        </label>
        <textarea
          id="guild-apply-reason"
          ref={textareaRef}
          className="guild-apply-textarea"
          rows={5}
          value={reason}
          disabled={busy}
          placeholder="比如：喜欢贵馆的创作氛围 / 希望参与 XX 企划…"
          aria-describedby="guild-apply-counter"
          onChange={(e) => onReasonChange(clampGuildApplyReason(e.target.value))}
          onKeyDown={(e) => {
            // Enter 换行；Ctrl/Cmd+Enter 快捷提交
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <span
          id="guild-apply-counter"
          className={`guild-apply-counter${nearLimit ? " is-warn" : ""}`}
          aria-live="polite"
        >
          {count}/{GUILD_APPLY_REASON_MAX}
          {nearLimit ? " · 接近上限" : ""}
        </span>
      </div>

      <div className="report-actions guild-apply-actions">
        <button type="button" className="report-cancel" disabled={busy} onClick={close}>
          取消
        </button>
        <button type="button" className="report-submit" disabled={busy} onClick={submit}>
          {busy ? "提交中..." : "提交申请"}
        </button>
      </div>
    </Modal>
  );
}
