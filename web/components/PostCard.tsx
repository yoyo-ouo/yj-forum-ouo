import Link from "next/link";
import type { Post } from "@/lib/api";
import { categoryColor, categoryLabel, timeAgo } from "@/lib/constants";
import { InlinePrefixBadge } from "./PrefixBadge";

/** 帖子卡片（与 legacy renderPostCard 结构 1:1） */
export default function PostCard({ post, showTime = true }: { post: Post; showTime?: boolean }) {
  const catColor = categoryColor(post.category);
  const catLabel = categoryLabel(post.category);
  const summary = (post.summary || "").replace(/<[^>]+>/g, "").substring(0, 100);

  return (
    <Link className="post-card" href={`/post/${post.id}`}>
      <div className="post-card-left">
        <div className="post-card-avatar">
          {post.user_avatar ? (
            <img src={post.user_avatar} alt="" loading="lazy" />
          ) : (
            <i className="fa fa-user avatar-fallback"></i>
          )}
        </div>
      </div>
      <div className="post-card-body">
        <div className="post-card-header">
          <span className="post-card-category" style={{ background: `${catColor}22`, color: catColor }}>
            {catLabel}
          </span>
          <span className="post-card-author Username">
            {post.user_name || "匿名"}
            <InlinePrefixBadge userId={post.user_id} />
          </span>
          {showTime && <span className="post-card-time">{timeAgo(post.created_at)}</span>}
        </div>
        <h3 className="post-card-title">{post.title}</h3>
        <p className="post-card-summary">
          {summary}
          {summary.length >= 100 ? "..." : ""}
        </p>
        <div className="post-card-footer">
          <span className="post-card-stats">
            <i className="fa fa-eye"></i> {post.views || 0}
          </span>
          <span className="post-card-stats">
            <i className="fa fa-thumbs-up"></i> {post.likes || 0}
          </span>
          <span className="post-card-stats">
            <i className="fa fa-comment"></i> 评论
          </span>
        </div>
      </div>
    </Link>
  );
}
