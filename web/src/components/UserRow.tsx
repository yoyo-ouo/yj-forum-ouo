import React, { useState } from "react";
import { Avatar } from "./mobile";
import { Icon } from "./icons";
import type { FollowUser } from "../lib/types";

export interface UserRowProps {
  user: FollowUser;
  /** 点头像/昵称区打开用户主页 */
  onOpen?: () => void;
  /** 关注/取消关注；不传则不显示按钮 */
  onToggleFollow?: () => void | Promise<void>;
  /** 外部请求中状态 */
  busy?: boolean;
  /** 是否展示「共同关注」标签（默认展示） */
  showMutual?: boolean;
}

/** 关注/粉丝/共同关注列表行：头像 + 昵称 + 简介 + 关注按钮 + 共同关注标签 */
export function UserRow({ user, onOpen, onToggleFollow, busy = false, showMutual = true }: UserRowProps) {
  const [pending, setPending] = useState(false);
  const following = Boolean(user.is_following);

  const toggle = async () => {
    if (!onToggleFollow || pending || busy) return;
    setPending(true);
    try {
      await onToggleFollow();
    } finally {
      setPending(false);
    }
  };

  const main = (
    <>
      <Avatar src={user.avatar} name={user.name} size={44} />
      <span className="ur-text">
        <span className="ur-name">
          <span className="ur-name-text">{user.name}</span>
          {user.prefix ? <i className="ur-prefix">{user.prefix}</i> : null}
        </span>
        {user.intro ? <span className="ur-intro">{user.intro}</span> : null}
        {showMutual && user.is_mutual ? (
          <span className="ur-mutual"><Icon name="users" size={12} />共同关注</span>
        ) : null}
      </span>
    </>
  );

  return (
    <div className="ur-row">
      {onOpen ? (
        <button type="button" className="ur-main" onClick={onOpen}>{main}</button>
      ) : (
        <div className="ur-main">{main}</div>
      )}
      {onToggleFollow && !user.is_self ? (
        <button
          type="button"
          className={`ur-follow ${following ? "on" : ""}`.trim()}
          disabled={pending || busy}
          aria-pressed={following}
          onClick={() => void toggle()}
        >
          {following ? "已关注" : "关注"}
        </button>
      ) : null}
    </div>
  );
}
