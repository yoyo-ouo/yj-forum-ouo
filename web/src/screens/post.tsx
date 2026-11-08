import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { RichContent } from "../components/ui";

/** TipTap/ProseMirror 体量大，只在打开评论编辑器时加载 */
const RichEditor = React.lazy(() =>
  import("../components/RichEditor").then((mod) => ({ default: mod.RichEditor })),
);
import { AppBar, Avatar, Confirm, Empty, IconButton, Screen, Sheet, Skeletons } from "../components/mobile";
import { Icon } from "../components/icons";
import { ReportSheet } from "../components/ReportSheet";
import { categoryColor, categoryLabel, contrastText, timeAgo } from "../lib/format";
import { shareContent, vibrate } from "../lib/native";
import type { CommentItem } from "../lib/types";

const postUrl = (id: string | number) => `https://www.yjlt.top/post/${id}`;

/** 会馆身份色：明暗主题下都能读的淡色徽标 */
function guildTint(color?: string | null): React.CSSProperties {
  const tint = color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : "var(--color-primary)";
  return {
    background: `color-mix(in srgb, ${tint} 16%, transparent)`,
    color: `color-mix(in srgb, ${tint} 60%, var(--color-text-primary))`,
  };
}

export function PostScreen({ id }: { id?: string | number }) {
  const postId = String(id || "");
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { push, pop, reset, canGoBack } = useNav();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [favorited, setFavorited] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const commentsRef = useRef<HTMLElement | null>(null);

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
    () => [...legacyComments, ...comments].sort((a, b) => Number(a.id) - Number(b.id)),
    [legacyComments, comments],
  );
  const byId = useMemo(() => new Map(allComments.map((comment) => [comment.id, comment])), [allComments]);
  const commentCount = post?.comment_count ?? allComments.length;

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

  const likeComment = async (comment: CommentItem) => {
    try {
      const res = await api.likeComment(comment.id);
      setComments((current) => current.map((item) => (item.id === comment.id ? { ...item, liked_by_me: res.liked, likes: res.likes } : item)));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "操作失败", "error");
    }
  };

  const removeComment = async (comment: CommentItem) => {
    try {
      await api.deleteComment(comment.id);
      setComments((current) => current.filter((item) => item.id !== comment.id));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除失败", "error");
    }
  };

  const submitComment = async () => {
    if (!user) {
      setCommentOpen(false);
      push("auth");
      return;
    }
    if (!draft.replace(/<[^>]+>/g, "").trim()) return showToast("评论不能为空", "error");
    setSubmitting(true);
    try {
      await api.createComment(postId, draft, replyTo?.id);
      setDraft("");
      setReplyTo(null);
      setCommentOpen(false);
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

  const openComment = () => {
    if (!user) return push("auth");
    setReplyTo(null);
    setCommentOpen(true);
  };

  const openReply = (comment: CommentItem) => {
    if (!user) return push("auth");
    setReplyTo(comment);
    setCommentOpen(true);
  };

  const share = useCallback(() => {
    if (!post) return;
    void shareContent({ text: post.title, url: postUrl(post.id) });
  }, [post]);

  const copyLink = async () => {
    if (!post) return;
    const url = postUrl(post.id);
    setMoreOpen(false);
    try {
      await navigator.clipboard.writeText(url);
      showToast("链接已复制");
    } catch {
      void shareContent({ text: post.title, url });
    }
  };

  const scrollToComments = () => commentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const author = post ? post.user_name || post.author_name || "论坛用户" : "";
  const isMine = Boolean(post && user && String(user.id) === String(post.user_id));

  return (
    <Screen
      className="pd-screen"
      appbar={
        <AppBar
          back
          title="帖子"
          actions={
            post ? (
              <>
                <IconButton icon="share" label="分享" onClick={share} />
                <IconButton icon="more" label="更多" onClick={() => setMoreOpen(true)} />
              </>
            ) : null
          }
        />
      }
      footer={
        post ? (
          <div className="m-actionbar pd-actionbar">
            <button className="m-comment-cta" onClick={openComment}>
              {user ? "写评论…" : "登录后参与评论"}
            </button>
            <button
              className={`m-action ${liked ? "on m-like" : ""}`.trim()}
              onClick={() => void toggleLike()}
              aria-label={liked ? "取消点赞" : "点赞"}
            >
              <Icon name="like" size={21} />
              <span>{likes}</span>
            </button>
            <button
              className={`m-action ${favorited ? "on" : ""}`.trim()}
              onClick={() => void toggleFavorite()}
              aria-label={favorited ? "取消收藏" : "收藏"}
            >
              <Icon name="bookmark" size={21} />
            </button>
            <button className="m-action" onClick={scrollToComments} aria-label="查看评论">
              <Icon name="comment" size={21} />
              <span>{commentCount}</span>
            </button>
            <button className="m-action" onClick={share} aria-label="分享">
              <Icon name="share" size={21} />
            </button>
          </div>
        ) : null
      }
    >
      {detail.isLoading ? (
        <Skeletons count={2} />
      ) : !post ? (
        <Empty icon="compass" title="帖子不存在" hint="可能已被删除，或链接有误" />
      ) : (
        <>
          <article className="pd-article">
            <div className="pd-badges">
              <span className="pd-cat" style={{ background: categoryColor(post.category), color: contrastText(categoryColor(post.category)) }}>
                {categoryLabel(post.category)}
              </span>
              {post.guild_name ? (
                <span className="pd-guild" style={guildTint(post.guild_theme_color)}>{post.guild_name}</span>
              ) : null}
            </div>

            <h1 className="pd-title">{post.title}</h1>

            <div className="pd-author">
              <button className="pd-author-ava" onClick={() => push("user", { id: post.user_id })} aria-label={author}>
                <Avatar src={post.user_avatar || post.author_avatar} name={author} size={32} />
              </button>
              <div className="pd-author-main">
                <div className="pd-author-name-row">
                  <button className="pd-author-name" onClick={() => push("user", { id: post.user_id })}>{author}</button>
                  {post.user_guild_name ? (
                    <span className="pd-user-guild" style={guildTint(post.user_guild_theme_color)}>{post.user_guild_name}</span>
                  ) : null}
                </div>
                <div className="pd-author-meta">
                  {timeAgo(post.published_at || post.created_at)} · {(post.views ?? 0).toLocaleString("zh-CN")} 浏览
                </div>
              </div>
            </div>

            <div className="pd-divider" />

            <div className="pd-rich m-rich">
              <RichContent html={post.content} format={post.content_format} />
            </div>
          </article>

          <section className="pd-comments" ref={commentsRef}>
            <h2 className="pd-comments-title">评论 {commentCount}</h2>

            {hasMore ? (
              <button className="pd-load-older" onClick={() => void loadOlder()} disabled={loadingMore}>
                {loadingMore ? "加载中…" : "加载更早的评论"}
              </button>
            ) : null}

            {commentQuery.isLoading ? (
              <Skeletons count={2} />
            ) : allComments.length === 0 ? (
              <div className="pd-comments-empty">还没有评论，来说两句吧</div>
            ) : (
              <div className="pd-comment-list">
                {allComments.map((comment) => {
                  const parent = comment.parent_id ? byId.get(comment.parent_id) : null;
                  const commentAuthor = comment.user_name || comment.author_name || "论坛用户";
                  const mine = Boolean(user && String(user.id) === String(comment.user_id));
                  return (
                    <div key={comment.id} className="pd-comment">
                      <button className="pd-comment-ava" onClick={() => push("user", { id: comment.user_id })} aria-label={commentAuthor}>
                        <Avatar src={comment.user_avatar || comment.author_avatar} name={commentAuthor} size={32} />
                      </button>
                      <div className="pd-comment-main">
                        <div className="pd-comment-head">
                          <button className="pd-comment-name" onClick={() => push("user", { id: comment.user_id })}>{commentAuthor}</button>
                          {comment.user_guild_name ? (
                            <span className="pd-user-guild pd-user-guild--sm" style={guildTint(comment.user_guild_theme_color)}>
                              {comment.user_guild_name}
                            </span>
                          ) : null}
                          <span className="pd-comment-time">{timeAgo(comment.created_at)}</span>
                        </div>
                        <div className={`pd-comment-content ${parent ? "pd-comment-content--reply" : ""}`.trim()}>
                          {parent ? (
                            <div className="pd-reply-line">
                              回复 <b>@{parent.user_name || parent.author_name || "用户"}</b>
                            </div>
                          ) : null}
                          <div className="pd-comment-text m-rich">
                            <RichContent html={comment.content} format={comment.content_format} />
                          </div>
                        </div>
                        <div className="pd-comment-foot">
                          <button
                            className={`pd-cmt-act ${comment.liked_by_me ? "on" : ""}`.trim()}
                            onClick={() => void likeComment(comment)}
                            aria-label={comment.liked_by_me ? "取消点赞" : "点赞"}
                          >
                            <Icon name="like" size={13} />
                            {comment.likes ?? 0}
                          </button>
                          <button className="pd-cmt-act" onClick={() => openReply(comment)}>
                            <Icon name="comment" size={13} />
                            回复
                          </button>
                          {mine ? (
                            <button className="pd-cmt-act pd-cmt-del" onClick={() => void removeComment(comment)} aria-label="删除评论">
                              <Icon name="trash" size={13} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <Sheet
            open={commentOpen}
            title={replyTo ? `回复 @${replyTo.user_name || replyTo.author_name || "用户"}` : "写评论"}
            onClose={() => setCommentOpen(false)}
            footer={
              <button className="m-btn m-btn--primary" disabled={submitting} onClick={() => void submitComment()}>
                {submitting ? "发送中…" : "发送"}
              </button>
            }
          >
            {replyTo ? (
              <div className="pd-reply-chip">
                <span>回复 @{replyTo.user_name || replyTo.author_name || "用户"}</span>
                <button onClick={() => setReplyTo(null)} aria-label="取消回复">
                  <Icon name="close" size={14} />
                </button>
              </div>
            ) : null}
            <Suspense fallback={<div className="m-editor-loading">编辑器加载中…</div>}>
              <RichEditor
                value={draft}
                onChange={setDraft}
                placeholder="友善交流，说点什么…"
                scene="comment_image"
                minHeight={140}
                toolbar="compact"
                autoFocus
              />
            </Suspense>
          </Sheet>

          <Sheet open={moreOpen} title="帖子操作" onClose={() => setMoreOpen(false)}>
            <div className="pd-menu">
              <button className="pd-menu-row" onClick={() => void copyLink()}>
                <Icon name="link" size={18} />
                <span>复制链接</span>
              </button>
              {user && !isMine ? (
                <button
                  className="pd-menu-row"
                  onClick={() => {
                    setMoreOpen(false);
                    setReportOpen(true);
                  }}
                >
                  <Icon name="flag" size={18} />
                  <span>举报</span>
                </button>
              ) : null}
              {isMine ? (
                <button
                  className="pd-menu-row pd-menu-row--danger"
                  onClick={() => {
                    setMoreOpen(false);
                    setConfirmDelete(true);
                  }}
                >
                  <Icon name="trash" size={18} />
                  <span>删除帖子</span>
                </button>
              ) : null}
              <button className="pd-menu-row" onClick={() => setMoreOpen(false)}>
                <Icon name="close" size={18} />
                <span>取消</span>
              </button>
            </div>
          </Sheet>

          <ReportSheet
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            onSubmit={async (reason, detail) => {
              // 失败时 ReportSheet 会留在弹层里展示错误，这里只负责报成功
              await api.reportPost(post.id, reason, detail);
              showToast("举报已提交");
            }}
          />

          <Confirm
            open={confirmDelete}
            title="删除这篇帖子？"
            confirmText="删除"
            onCancel={() => setConfirmDelete(false)}
            onConfirm={async () => {
              setConfirmDelete(false);
              try {
                await api.deletePost(post.id);
                showToast("已删除");
                // 回到来源页；无上一页时重置到广场，避免多出一层无 TabBar 的广场
                if (canGoBack) pop();
                else reset("feed");
              } catch (e) {
                showToast(e instanceof Error ? e.message : "删除失败", "error");
              }
            }}
          >
            删除后帖子将不可见。
          </Confirm>
        </>
      )}
    </Screen>
  );
}
