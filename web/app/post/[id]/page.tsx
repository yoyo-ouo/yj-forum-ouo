"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Header, { showCenterCard } from "@/components/Header";
import { postApi, Post, Comment, ApiException } from "@/lib/api";
import { useStore } from "@/lib/store";
import { marked } from "marked";

function timeAgo(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "综合", talk: "闲聊", question: "求助", share: "分享", creative: "创作",
};

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, userId } = useStore();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [liked, setLiked] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await postApi.detail(id);
      setPost(r.post);
      setComments(r.comments || []);
      setLiked(r.liked);
      setFavorited(r.favorited);
    } catch (e) {
      setErr(e instanceof ApiException ? e.message : "帖子不存在");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const doLike = async () => {
    if (!userId) return router.push("/login");
    try {
      const r = await postApi.like(id);
      setLiked(r.liked);
      setPost((p) => (p ? { ...p, likes: r.likes } : p));
    } catch (e: any) {
      showCenterCard(`<p>${e.message}</p>`);
    }
  };

  const doFavorite = async () => {
    if (!userId) return router.push("/login");
    try {
      const r = await postApi.favorite(id);
      setFavorited(r.favorited);
    } catch (e: any) {
      showCenterCard(`<p>${e.message}</p>`);
    }
  };

  const submitComment = async () => {
    if (!userId) return router.push("/login");
    if (!commentText.trim()) return;
    try {
      const r = await postApi.createComment(id, commentText.trim(), replyTo?.id);
      setComments((prev) => [...prev, r.comment]);
      setCommentText("");
      setReplyTo(null);
    } catch (e: any) {
      showCenterCard(`<p>${e.message}</p>`);
    }
  };

  const deletePost = async () => {
    if (!window.confirm("确定删除这篇帖子吗？")) return;
    try {
      await postApi.remove(id);
      router.push("/forum");
    } catch (e: any) {
      showCenterCard(`<p>${e.message}</p>`);
    }
  };

  const reportPost = async () => {
    const reason = window.prompt("请填写举报原因（必填）");
    if (!reason) return;
    const detail = window.prompt("补充说明（可选）") || "";
    try {
      await postApi.report(id, reason, detail);
      showCenterCard(`<p style="text-align:center">举报成功，感谢反馈！</p>`);
    } catch (e: any) {
      showCenterCard(`<p>${e.message}</p>`);
    }
  };

  if (loading) return <><Header /><div className="forum-loading" style={{ padding: 40 }}>加载中...</div></>;
  if (!post) return <><Header /><div className="forum-loading" style={{ padding: 40 }}>{err || "帖子不存在"}</div></>;

  return (
    <>
      <Header />
      <div className="forum-container" style={{ maxWidth: 900 }}>
        <article className="post-detail-card">
          <div className="post-detail-meta">
            <span className="post-card-category">{CATEGORY_LABELS[post.category] || post.category || "综合"}</span>
            <Link className="post-card-author" href={`/users/${post.user_id}`}>{post.user_name}</Link>
            <span className="post-card-time">{timeAgo(post.created_at)}</span>
          </div>
          <h1 className="post-detail-title">{post.title}</h1>
          <div className="markdown-body post-detail-content" dangerouslySetInnerHTML={{ __html: marked.parse(post.content || "", { async: false }) as string }} />

          <div className="post-detail-actions">
            <button className={`action-btn ${liked ? "active" : ""}`} onClick={doLike}>
              <i className="fa fa-heart"></i> {liked ? "已赞" : "点赞"} ({post.likes})
            </button>
            <button className={`action-btn ${favorited ? "active" : ""}`} onClick={doFavorite}>
              <i className="fa fa-star"></i> {favorited ? "已收藏" : "收藏"}
            </button>
            <button className="action-btn" onClick={reportPost}><i className="fa fa-flag"></i> 举报</button>
            {userId === post.user_id && (
              <button className="action-btn danger" onClick={deletePost}><i className="fa fa-trash"></i> 删除</button>
            )}
          </div>
        </article>

        <section className="comments-section">
          <h2 className="comments-title"><i className="fa fa-comments"></i> 评论 ({comments.length})</h2>

          <div className="comment-editor">
            {replyTo && (
              <div className="comment-reply-hint">
                回复 @{replyTo.user_name} <button onClick={() => setReplyTo(null)}>取消</button>
              </div>
            )}
            <textarea className="form-editor" rows={3} placeholder={userId ? "写下你的评论..." : "登录后参与评论"} value={commentText} disabled={!userId} onChange={(e) => setCommentText(e.target.value)} />
            <button className="submit-button" disabled={!userId} onClick={submitComment}>发表评论</button>
          </div>

          <div className="comment-list">
            {comments.length === 0 ? (
              <div className="forum-loading">暂无评论，快来抢沙发~</div>
            ) : (
              comments.map((c) => (
                <div className="comment-item" key={c.id}>
                  <img className="comment-avatar" src={c.user_avatar} alt="" loading="lazy" />
                  <div className="comment-body">
                    <div className="comment-meta">
                      <Link className="comment-author" href={`/users/${c.user_id}`}>{c.user_name}</Link>
                      <span className="comment-time">{timeAgo(c.created_at)}</span>
                      {userId && (
                        <button className="comment-reply-btn" onClick={() => { setReplyTo(c); setCommentText(`@${c.user_name} `); }}>回复</button>
                      )}
                    </div>
                    <p className="comment-content">{c.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}
