"use client";

// 我的草稿分组（首页 / 论坛广场共用）：仅登录本人可见。
// 草稿不进入公共信息流接口，由前端单独拉取并置顶展示；点卡片进入发帖页继续编辑。

import PostCard from "./PostCard";
import type { PostDraftItem } from "@/lib/api";

export default function PostDraftSection({
  drafts,
  userId,
  hint = "仅自己可见 · 点开继续编辑",
}: {
  drafts: PostDraftItem[];
  userId: string;
  hint?: string;
}) {
  if (drafts.length === 0) return null;
  return (
    <div className="forum-draft-section">
      <div className="forum-draft-section-head">
        <span>
          <i className="fa fa-file-text-o"></i> 我的草稿
        </span>
        <span className="forum-draft-section-hint">{hint}</span>
      </div>
      {drafts.map((d) => (
        <PostCard
          key={`d-${d.id}`}
          post={{
            id: d.id,
            user_id: userId,
            title: d.title,
            summary: d.summary,
            category: d.category,
            likes: 0,
            views: 0,
            comment_count: 0,
            created_at: d.created_at,
            updated_at: d.updated_at,
            user_name: "",
            user_avatar: "",
            guild_name: d.guild_name,
            guild_theme_color: d.guild_theme_color,
            is_draft: true,
          }}
          showSpace
        />
      ))}
    </div>
  );
}
