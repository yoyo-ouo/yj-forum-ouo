import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { Avatar, CategoryBadge, Confirm, EmptyState, Loading, RichContent, SpaceBadge, TopBar } from "../components/ui";
import { RichEditor } from "../components/RichEditor";
import { formatDate, timeAgo } from "../lib/format";
import { shareContent, vibrate } from "../lib/native";
import type { CommentItem } from "../lib/types";

export function PostScreen({ id }: { id?: string | number }) {
  const postId = String(id || "");
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { push } = useNav();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [favorited, setFavorited] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detail = useQuery({ queryKey: ["post", postId], queryFn: () => api.postDetail(postId), enabled: Boolean(postId) });
  const commentQuery = useQuery({ queryKey: ["comments", postId], queryFn: () => api.comments(postId, undefined, 50), enabled: Boolean(postId) });

  useEffect(() => {
    if (commentQuery.data) {
      setComments(commentQuery.data.comments || []);
      setHasMore(Boolean(commentQuery.data.has_more));
    }
  }, [commentQuery.data]);

  useEffect(() => {
    if (detail.data) {
      setLiked(Boolean(detail.data.liked));
      setLikes(detail.data.post.likes ?? 0);
      setFavorited(Boolean(detail.data.favorited));
    }
  }, [detail.data]);

  const post = detail.data?.post;
  const legacyComments = useMemo(
    () => (detail.data?.comments || []).filter((comment) => !comments.some((item) => item.id === comment.id)),
    [detail.data, comments],
  );
  const allComments = useMemo(
    () => [...legacyComments, ...comments].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    [legacyComments, comments],
  );
  const byId = useMemo(() => new Map(allComments.map((comment) => [comment.id, comment])), [allComments]);

  const loadOlder = async () => {
    if (!allComments.length) return;
    setLoadingMore(true);
    try {
      const res = await api.comments(postId, allComments[0].id, 50);
      setComments((current) => [...(res.comments || []), ...current]);
      setHasMore(Boolean(res.has_more));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "加载失败", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleLike = async () => {
    try {
      const res = await api.likePost(postId);
      setLiked(res.liked);
      setLikes(res.likes);
      void vibrate(10);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "操作失败", "error");
    }
  };

  const toggleFavorite = async () => {
    try {
      const res = await api.favoritePost(postId);
      setFavorited(res.favorited);
      showToast(res.favorited ? "已收藏" : "已取消收藏");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "操作失败", "error");
    }
  };

  const submitComment = async () => {
    if (!user) return push("auth");
    if (!draft.replace(/<[^>]+>/g, "").trim()) return showToast("评论不能为空", "error");
    setSubmitting(true);
    try {
      await api.createComment(postId, draft, replyTo?.id);
      setDraft("");
      setReplyTo(null);
      const res = await api.comments(postId, undefined, 50);
      setComments(res.comments || []);
      setHasMore(Boolean(res.has_more));
      showToast("评论已发布");
      void detail.refetch();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "发布失败", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (detail.isLoading) return <div className="screen"><TopBar title="帖子详情" back /><Loading /></div>;
  if (!post) return <div className="screen"><TopBar title="帖子详情" back /><EmptyState text="帖子不存在或已被删除" /></div>;

  const author = post.user_name || post.author_name || "论坛用户";

  return (
    <div className="screen">
      <TopBar
        title="帖子详情"
        back
        actions={<button className="icon-btn" aria-label="分享" onClick={() => void shareContent({ text: post.title, url: `https://www.yjlt.top/post/${post.id}` })}><i className="fa fa-share-alt" /></button>}
      />
      <div className="post-detail-container">
        <article className="post-content">
          <div className="post-meta-top">
            <CategoryBadge category={post.category} className="post-category-badge" />
            <SpaceBadge name={post.guild_name} color={post.guild_theme_color} />
          </div>
          <h1 className="post-title">{post.title}</h1>
          <div className="post-author-row">
            <button className="post-author-avatar" onClick={() => push("user", { id: post.user_id })}>
              <Avatar src={post.user_avatar || post.author_avatar} name={author} size={44} />
            </button>
            <div className="post-author-info">
              <div className="post-author-name-row">
                <button className="post-author-name" onClick={() => push("user", { id: post.user_id })}>{author}</button>
                {post.user_guild_name ? <SpaceBadge name={post.user_guild_name} color={post.user_guild_theme_color} className="user-guild-chip" /> : null}
              </div>
              <div className="post-author-meta">
                <span>{formatDate(post.published_at || post.created_at)}</span>
                <span>·</span>
                <span><i className="fa fa-eye" /> {post.views ?? 0}</span>
              </div>
            </div>
          </div>
          <div className="post-body-html">
            <RichContent html={post.content} format={post.content_format} />
          </div>
          <div className="post-actions">
            <button className={`post-action-btn ${liked ? "liked" : ""}`} onClick={() => void toggleLike()}>
              <i className="fa fa-thumbs-up" /><span>{likes}</span>
            </button>
            <button className={`post-action-btn ${favorited ? "favorited" : ""}`} onClick={() => void toggleFavorite()}>
              <i className="fa fa-bookmark" /><span className="post-action-label">{favorited ? "已收藏" : "收藏"}</span>
            </button>
            <button className="post-action-btn" onClick={() => { setReplyTo(null); document.querySelector(".comment-input-bar")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
              <i className="fa fa-comment" /><span>{post.comment_count ?? allComments.length}</span>
            </button>
            <button className="post-action-btn" onClick={() => void shareContent({ text: post.title, url: `https://www.yjlt.top/post/${post.id}` })}>
              <i className="fa fa-share-alt" /><span className="post-action-label">分享</span>
            </button>
            {user && String(user.id) === String(post.user_id) ? (
              <button className="post-action-btn post-delete-btn" onClick={() => setConfirmDelete(true)}>
                <i className="fa fa-trash-o" /><span className="post-action-label">删除</span>
              </button>
            ) : null}
          </div>
        </article>

        <div className="comment-section">
          <div className="comment-section-title">评论 {post.comment_count ?? allComments.length}</div>
          {user ? (
            <div className="comment-input-bar">
              {replyTo ? (
                <div className="comment-reply-indicator">
                  <span>回复 <strong>{replyTo.user_name || "用户"}</strong></span>
                  <button className="link-btn" onClick={() => setReplyTo(null)}>取消</button>
                </div>
              ) : null}
              <div className="comment-editor">
                <RichEditor value={draft} onChange={setDraft} placeholder="友善交流，说点什么…" scene="comment_image" minHeight={110} />
              </div>
              <div className="row between">
                <span className="small muted">发布评论会自动完成 APP 零 PoW 验证</span>
                <button className="comment-send-btn" disabled={submitting} onClick={() => void submitComment()}>{submitting ? "发送中…" : "发送"}</button>
              </div>
            </div>
          ) : (
            <div className="comment-login-gate">
              <span>登录后参与评论</span>
              <button className="comment-login-btn" onClick={() => push("auth")}>去登录</button>
            </div>
          )}

          {hasMore ? (
            <div className="forum-load-more">
              <button onClick={() => void loadOlder()} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更早的评论"}</button>
            </div>
          ) : null}
          <div className="comment-list">
            {allComments.length === 0 ? <EmptyState text="还没有评论，来说两句吧" /> : allComments.map((comment) => {
              const parent = comment.parent_id ? byId.get(comment.parent_id) : null;
              return (
                <div key={comment.id} className="comment-item">
                  <button className="comment-avatar" onClick={() => push("user", { id: comment.user_id })}>
                    <Avatar src={comment.user_avatar || comment.author_avatar} name={comment.user_name || comment.author_name} size={36} />
                  </button>
                  <div className="comment-body">
                    <div className="comment-header">
                      <button className="comment-author" onClick={() => push("user", { id: comment.user_id })}>{comment.user_name || comment.author_name || "论坛用户"}</button>
                      {comment.user_guild_name ? <SpaceBadge name={comment.user_guild_name} color={comment.user_guild_theme_color} className="user-guild-chip" /> : null}
                      <span className="comment-time">{timeAgo(comment.created_at)}</span>
                    </div>
                    {parent ? <div className="comment-reply-to">回复 <strong>{parent.user_name || "用户"}</strong></div> : null}
                    <div className="comment-text"><RichContent html={comment.content} format={comment.content_format} /></div>
                    <div className="comment-footer">
                      <button className={`comment-like comment-like-btn ${comment.liked_by_me ? "liked" : ""}`} onClick={async () => { try { await api.likeComment(comment.id); } catch { /* ignore */ } }}>
                        <i className={`fa ${comment.liked_by_me ? "fa-thumbs-up" : "fa-thumbs-o-up"}`} /> {comment.likes ?? 0}
                      </button>
                      <button className="comment-reply-btn" onClick={() => { setReplyTo(comment); document.querySelector(".comment-input-bar")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                        <i className="fa fa-reply" /> 回复
                      </button>
                      {user && String(user.id) === String(comment.user_id) ? (
                        <button className="comment-delete-btn" onClick={async () => { try { await api.deleteComment(comment.id); setComments((current) => current.filter((item) => item.id !== comment.id)); } catch (e) { showToast(e instanceof Error ? e.message : "删除失败", "error"); } }}>
                          <i className="fa fa-trash-o" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Confirm
        open={confirmDelete}
        title="删除这篇帖子？"
        confirmText="删除"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => { setConfirmDelete(false); try { await api.deletePost(post.id); showToast("已删除"); push("feed"); } catch (e) { showToast(e instanceof Error ? e.message : "删除失败", "error"); } }}
      >
        删除后帖子将不可见。
      </Confirm>
    </div>
  );
}
