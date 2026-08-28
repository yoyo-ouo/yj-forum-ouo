"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import Header from "@/components/Header";
import { useCenterCard } from "@/components/CenterCard";
import Markdown from "@/components/Markdown";
import CommentSection from "@/components/CommentSection";
import { InlinePrefixBadge } from "@/components/PrefixBadge";
import { postApi, Comment, ApiException } from "@/lib/api";
import { useStore } from "@/lib/store";
import { categoryColor, categoryLabel, formatTime } from "@/lib/constants";

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, userId } = useStore();
  const { show } = useCenterCard();
  const [post, setPost] = useState<any | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [liked, setLiked] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

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
      setPost((p: any) => (p ? { ...p, likes: r.likes } : p));
    } catch (e: any) {
      show(<p>{e.message}</p>);
    }
  };

  const doFavorite = async () => {
    if (!userId) return router.push("/login");
    try {
      const r = await postApi.favorite(id);
      setFavorited(r.favorited);
    } catch (e: any) {
      show(<p>{e.message}</p>);
    }
  };

  const submitComment = async () => {
    if (!userId) return router.push("/login");
    const content = commentText.trim();
    if (!content) return;
    try {
      const r = await postApi.createComment(id, content, replyTo?.id);
      setComments((prev) => [...prev, r.comment]);
      setCommentText("");
      setReplyTo(null);
    } catch (e: any) {
      show(<p>{e.message}</p>);
    }
  };

  const deleteComment = async (cid: string) => {
    if (!window.confirm("确定删除这条评论吗？")) return;
    try {
      await postApi.deleteComment(cid);
      setComments((prev) => prev.filter((c) => c.id !== cid));
    } catch (e: any) {
      show(<p>{e.message}</p>);
    }
  };

  const deletePost = async () => {
    if (!window.confirm("确定删除这篇帖子吗？")) return;
    try {
      await postApi.remove(id);
      router.push("/forum");
    } catch (e: any) {
      show(<p>{e.message}</p>);
    }
  };

  const reportPost = async () => {
    const reason = window.prompt("请填写举报原因（必填）");
    if (!reason) return;
    const detail = window.prompt("补充说明（可选）") || "";
    try {
      await postApi.report(id, reason, detail);
      show(<p style={{ textAlign: "center" }}>举报成功，感谢反馈！</p>);
    } catch (e: any) {
      show(<p>{e.message}</p>);
    }
  };

  if (loading) return <><Header /><div className="post-loading" style={{ padding: 40 }}>加载中...</div></>;
  if (!post) return <><Header /><div className="post-error" style={{ padding: 40 }}>{err || "帖子不存在"}</div></>;

  const catColor = categoryColor(post.category);
  const catLabel = categoryLabel(post.category);
  const mainCount = comments.filter((c) => !c.parent_id).length;

  const sharePost = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        show(<p style={{ textAlign: "center" }}>链接已复制</p>);
      }
    } catch {
      /* 用户取消分享 */
    }
  };

  return (
    <>
      <Header />
      <div className="post-detail-container">
        <div className="post-detail-header">
          <a href="/forum" className="post-back-btn" onClick={(e) => { e.preventDefault(); router.back(); }}>
            <i className="fa fa-arrow-left"></i> 返回
          </a>
        </div>

        <article className="post-content">
          <div className="post-meta-top">
            <span className="post-category-badge" style={{ background: `${catColor}22`, color: catColor }}>{catLabel}</span>
          </div>
          <h1 className="post-title">{post.title}</h1>

          <div className="post-author-row">
            <Link href={`/users/${post.user_id}`} className="post-author-avatar">
              {post.user_avatar ? (
                <img src={post.user_avatar} alt="" loading="lazy" />
              ) : (
                <i className="fa fa-user avatar-fallback"></i>
              )}
            </Link>
            <div className="post-author-info">
              <Link href={`/users/${post.user_id}`} className="post-author-name Username">
                {post.user_name || "匿名"}
                <InlinePrefixBadge userId={post.user_id} />
              </Link>
              <div className="post-author-meta">
                <span>{formatTime(post.created_at)}</span>
                <span>·</span>
                <span><i className="fa fa-eye"></i> {post.views || 0}</span>
              </div>
            </div>
          </div>

          <div className="post-body-html">
            <Markdown content={post.content} />
          </div>

          <div className="post-actions">
            <button className={`post-action-btn ${liked ? "liked" : ""}`} id="post-like-btn" onClick={doLike}>
              <i className="fa fa-thumbs-up"></i>
              <span id="post-like-count">{post.likes || 0}</span>
            </button>
            <button className={`post-action-btn ${favorited ? "favorited" : ""}`} id="post-favorite-btn" onClick={doFavorite}>
              <i className="fa fa-bookmark"></i>
              <span className="post-action-label">收藏</span>
            </button>
            <button className="post-action-btn" onClick={() => inputRef.current?.focus()}>
              <i className="fa fa-comment"></i>
              <span>{mainCount}</span>
            </button>
            <button className="post-action-btn" onClick={sharePost}>
              <i className="fa fa-share-alt"></i>
              <span className="post-action-label">分享</span>
            </button>
            {(!userId || post.user_id !== userId) && (
              <button className="post-action-btn" onClick={reportPost}>
                <i className="fa fa-flag"></i>
                <span className="post-action-label">举报</span>
              </button>
            )}
            {userId && post.user_id === userId && (
              <button className="post-action-btn post-delete-btn" onClick={deletePost}>
                <i className="fa fa-trash-o"></i>
                <span className="post-action-label">删除</span>
              </button>
            )}
          </div>
        </article>

        <div className="comment-section">
          <CommentSection
            comments={comments}
            userId={userId}
            inputRef={inputRef}
            replyTo={replyTo}
            setReplyTo={setReplyTo}
            onChangeReplyText={setCommentText}
            onSubmit={submitComment}
            onDelete={deleteComment}
          />
        </div>
      </div>
    </>
  );
}
