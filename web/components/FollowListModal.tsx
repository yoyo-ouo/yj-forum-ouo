"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { UserBrief } from "@/lib/api";

/** 关注列表弹窗（与 legacy follow-list-modal 结构 1:1：标题/关注-粉丝Tab/列表项/关注按钮） */
export default function FollowListModal({
  title,
  users,
  currentUserId,
  onClose,
  onTabChange,
  onToggleFollow,
}: {
  title: string;
  users: UserBrief[];
  currentUserId: string | null;
  onClose: () => void;
  onTabChange: (tab: "following" | "followers") => void;
  onToggleFollow: (user: UserBrief) => Promise<void>;
}) {
  const [followedMap, setFollowedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeTab = title === "关注列表" ? "following" : "followers";

  const toggle = async (u: UserBrief) => {
    setFollowedMap((p) => ({ ...p, [u.id]: p[u.id] ? false : true }));
    await onToggleFollow(u);
  };

  return (
    <div id="follow-list-modal" className="follow-list-modal">
      <div className="follow-list-overlay" onClick={onClose}></div>
      <div className="follow-list-container">
        <div className="follow-list-header">
          <h3 id="follow-list-title">{title}</h3>
          <button className="follow-list-close" onClick={onClose}>&times;</button>
        </div>
        <div className="follow-list-tabs">
          <button className={`follow-tab ${activeTab === "following" ? "active" : ""}`} data-type="following" onClick={() => onTabChange("following")}>关注</button>
          <button className={`follow-tab ${activeTab === "followers" ? "active" : ""}`} data-type="followers" onClick={() => onTabChange("followers")}>粉丝</button>
        </div>
        <div id="follow-list-content" className="follow-list-content">
          {users.length === 0 ? (
            <p className="loading-text" style={{ textAlign: "center" }}>暂无{activeTab === "following" ? "关注" : "粉丝"}</p>
          ) : (
            users.map((u) => {
              const isSelf = currentUserId === u.id;
              const vipBadge = u.vip && u.vip !== "0" ? (
                <span className="follow-user-vip"><i className="fa fa-diamond"></i></span>
              ) : null;
              return (
                <div className="follow-user-item" key={u.id}>
                  <Link href={`/users/${u.id}`} className="follow-user-avatar">
                    <img src={u.avatar} alt={u.name} />
                    {vipBadge}
                  </Link>
                  <div className="follow-user-info">
                    <Link href={`/users/${u.id}`} className="follow-user-name Username">{u.name}</Link>
                    <p className="follow-user-intro">{u.intro || "这个人很懒，什么都没留下~"}</p>
                  </div>
                  {!isSelf && (
                    <button
                      className={`follow-btn ${followedMap[u.id] ? "followed" : ""}`}
                      onClick={() => toggle(u)}
                    >
                      {followedMap[u.id] ? "已关注" : "关注"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
