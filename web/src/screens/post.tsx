import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { Avatar, EmptyState, Loading, RichContent, Sheet, TopBar } from "../components/ui";
import { RichEditor } from "../components/RichEditor";
import { categoryLabel, formatDate, timeAgo } from "../lib/format";
import { shareContent, vibrate } from "../lib/native";
import type { CommentItem } from "../lib/types";

export function PostScreen({ id }: { id?: string | number }) {
  const postId = String(id || "");
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [favorited, setFavorited] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
  const legacyComments = useMemo(() => (detail.data?.comments || []).filter((c) => !comments.some((x) => x.id === c.id)), [detail.data, comments]);
  const allComments = [...legacyComments, ...comments].sort((a, b) => String(a.id).localeCompare(String(b.id)));

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
    if (!draft.replace(/<[^>]+>/g, "").trim()) return showToast("评论不能为空", "error");
    setSubmitting(true);
    try {
      await api.createComment(postId, draft, replyTo?.id);
      setDraft("");
      setReplyTo(null);
      setEditorOpen(false);
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

  return (
    <div className="screen">
      <TopBar
        title="帖子详情"
        back
        actions={<button className="icon-btn" aria-label="分享" onClick={() => void shareContent({ text: post.title, url: `https://www.yjlt.top/post/${post.id}` })}>↗</button>}
      />
      <div className="detail-head">
        <div className="detail-author">
          <Avatar src={post.user_avatar || post.author_avatar} name={post.user_name || post.author_name} size={36} />
          <div style={{ flex: 1 }}>
            <div className="post-name">{post.user_name || post.author_name || "论坛用户"}{post.user_guild_name ? <span className="pill">{post.user_guild_name}</span> : null}</div>
            <div className="post-meta">{categoryLabel(post.category)} · {formatDate(post.published_at || post.created_at)}</div>
          </div>
        </div>
        <h1 className="detail-title">{post.title}</h1>
        <div className="detail-meta"><span>♡ {likes}</span><span>💬 {post.comment_count ?? allComments.length}</span><span>◉ {post.views ?? 0}</span></div>
        <RichContent html={post.content} format={post.content_format} />
      </div>
      <div className="detail-actions">
        <button className={`action-btn ${liked ? "on" : ""}`} onClick={() => void toggleLike()}>{liked ? "♥" : "♡"} 点赞</button>
        <button className={`action-btn ${favorited ? "on" : ""}`} onClick={() => void toggleFavorite()}>☆ {favorited ? "已收藏" : "收藏"}</button>
        <button className="action-btn" onClick={() => { setReplyTo(null); setEditorOpen(true); }}>💬 评论</button>
      </div>
      <div className="section-head"><strong>评论 {post.comment_count ?? allComments.length}</strong><span className="small muted">按时间</span></div>
      {hasMore ? (
        <button className="load-more" onClick={() => void loadOlder()} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更早的评论"}</button>
      ) : null}
      <div className="comment-list">
        {allComments.length === 0 ? <EmptyState text="还没有评论，来说两句吧" /> : allComments.map((comment) => (
          <div key={comment.id} className="comment">
            <Avatar src={comment.user_avatar || comment.author_avatar} name={comment.user_name || comment.author_name} size={28} />
            <div className="comment-main">
              <div className="comment-name">{comment.user_name || comment.author_name || "论坛用户"}<span>{timeAgo(comment.created_at)}</span></div>
              <div className="comment-text"><RichContent html={comment.content} format={comment.content_format} /></div>
              <div className="comment-foot">
                <button className="link-btn" onClick={async () => { try { await api.likeComment(comment.id); } catch { /* ignore */ } }}>♡ {comment.likes ?? 0}</button>
                <button className="link-btn" onClick={() => { setReplyTo(comment); setEditorOpen(true); }}>回复</button>
                {user?.id === comment.user_id ? <button className="link-btn" onClick={async () => { try { await api.deleteComment(comment.id); setComments((c) => c.filter((x) => x.id !== comment.id)); } catch (e) { showToast(e instanceof Error ? e.message : "删除失败", "error"); } }}>删除</button> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="comment-bar" onClick={() => { setReplyTo(null); setEditorOpen(true); }}>
        <span>{replyTo ? `回复 @${replyTo.author_name || "用户"}` : "写下你的评论…"}</span>
        <button className="btn primary sm">写评论</button>
      </div>

      <Sheet
        open={editorOpen}
        title={replyTo ? `回复 @${replyTo.author_name || "用户"}` : "写评论"}
        onClose={() => setEditorOpen(false)}
        footer={<button className="btn primary block" disabled={submitting} onClick={() => void submitComment()}>{submitting ? "发布中…" : "发布评论"}</button>}
      >
        <RichEditor value={draft} onChange={setDraft} placeholder="友善交流，说点什么…" scene="comment_image" minHeight={160} />
        <div className="form-hint">发布评论会自动完成 APP 零 PoW 验证。</div>
      </Sheet>
    </div>
  );
}
