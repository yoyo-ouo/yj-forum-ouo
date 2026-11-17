import Link from "next/link";
import type { Post } from "@/lib/api";
import { timeAgo } from "@/lib/constants";
import CategoryBadge from "./ui/CategoryBadge";
import SpaceBadge from "./ui/SpaceBadge";
import { UserAvatar, UserName } from "./ui/UserAvatar";

/**
 * 帖子卡片（与 legacy renderPostCard 结构 1:1）；showSpace 默认开启，展示会馆/公共空间标签。
 * is_draft=true 时：链接指向发帖页继续编辑，显示「草稿 / 仅自己可见」，不展示作者与统计。
 */
export default function PostCard({
  post,
  showTime = true,
  showSpace = true,
}: {
  post: Post;
  showTime?: boolean;
  showSpace?: boolean;
}) {
  const summary = (post.summary || "").replace(/<[^>]+>/g, "").substring(0, 100);
  const isDraft = !!post.is_draft;
  const href = isDraft ? `/post/create?draft=${encodeURIComponent(post.id)}` : `/post/${post.id}`;
  const timeText = isDraft ? `编辑于 ${timeAgo(post.updated_at || post.created_at)}` : timeAgo(post.created_at);

  return (
    <Link className={`post-card${isDraft ? " post-card-draft" : ""}`} href={href}>
      <div className="post-card-left">
        <div className="post-card-avatar">
          <UserAvatar src={post.user_avatar} userId={post.user_id} />
        </div>
      </div>
      <div className="post-card-body">
        <div className="post-card-header">
          {isDraft && (
            <span className="post-draft-tag">
              <i className="fa fa-file-text-o"></i> 草稿
            </span>
          )}
          <CategoryBadge category={post.category} />
          {showSpace && <SpaceBadge name={post.guild_name} color={post.guild_theme_color} />}
          {!isDraft && (
            <span className="post-card-author Username">
              <UserName name={post.user_name} />
            </span>
          )}
          {showTime && <span className="post-card-time">{timeText}</span>}
        </div>
        <h3 className="post-card-title">{post.title.trim() || (isDraft ? "无标题草稿" : "")}</h3>
        <p className="post-card-summary">
          {summary || (isDraft ? "（还没有写正文）" : "")}
          {summary.length >= 100 ? "..." : ""}
        </p>
        <div className="post-card-footer">
          {isDraft ? (
            <span className="post-card-stats post-card-draft-hint">
              <i className="fa fa-lock"></i> 仅自己可见
            </span>
          ) : (
            <>
              <span className="post-card-stats">
                <i className="fa fa-eye"></i> {post.views || 0}
              </span>
              <span className="post-card-stats">
                <i className="fa fa-thumbs-up"></i> {post.likes || 0}
              </span>
              <span className="post-card-stats">
                <i className="fa fa-comment"></i> {post.comment_count ?? 0}
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
