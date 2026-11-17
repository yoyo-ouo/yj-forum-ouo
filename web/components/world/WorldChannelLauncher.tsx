"use client";

// 世界频道桌面入口按钮。
// 单独成文件的原因：入口会被 Header（全站每页）引入，而窗口本体带 TipTap/ProseMirror
// （共用 CommentEditor），若与入口同模块，编辑器会被打进全站首屏 chunk。

export interface WorldChannelLauncherProps {
  /** 点击打开世界频道 */
  onOpen: () => void;
  className?: string;
  /** 未读角标（可选；0 不显示） */
  badge?: number;
}

/** 桌面入口：固定视口右上角（Header 下方 16px）的纵向矩形按钮（≤700px 由 CSS 隐藏）。 */
export function WorldChannelLauncher({ onOpen, className = "", badge = 0 }: WorldChannelLauncherProps) {
  return (
    <button
      type="button"
      className={`world-channel-launcher${className ? ` ${className}` : ""}`}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label="打开世界频道"
      title="打开世界频道"
    >
      <i className="fa fa-globe" aria-hidden="true"></i>
      <span className="world-channel-launcher-text">世界频道</span>
      {badge > 0 && (
        <span className="world-channel-launcher-badge" aria-label={`${badge} 条未读`}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
