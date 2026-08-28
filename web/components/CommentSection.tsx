"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Comment } from "@/lib/api";
import { timeAgo } from "@/lib/constants";
import { InlinePrefixBadge } from "./PrefixBadge";
import Markdown from "./Markdown";

/** 单条评论（与 legacy renderComment 结构 1:1，支持回复标识/删除/回复按钮） */
function CommentItem({
  c,
  parent,
  isReply = false,
  canDelete,
  userId,
  onReply,
  onDelete,
}: {
  c: Comment;
  parent?: Comment | null;
  isReply?: boolean;
  canDelete: boolean;
  userId: string | null;
  onReply: (c: Comment) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={`comment-item ${isReply ? "comment-item-reply" : ""}`} data-comment-id={c.id}>
      <Link href={`/users/${c.user_id}`} className="comment-avatar">
        <img src={c.user_avatar || ""} alt="" loading="lazy" />
      </Link>
      <div className="comment-body">
        <div className="comment-header">
          <Link href={`/users/${c.user_id}`} className="comment-author Username">
            {c.user_name || "匿名"}
            <InlinePrefixBadge userId={c.user_id} />
          </Link>
          <span className="comment-time">{timeAgo(c.created_at)}</span>
        </div>
        {parent && (
          <div className="comment-reply-to">
            回复{" "}
            <Link href={`/users/${parent.user_id}`} className="Username">
              {parent.user_name || "匿名"}
              <InlinePrefixBadge userId={parent.user_id} />
            </Link>
          </div>
        )}
        <div className="comment-text">
          <Markdown content={c.content} />
        </div>
        <div className="comment-footer">
          <span className="comment-like">
            <i className="fa fa-thumbs-o-up"></i> {c.likes || 0}
          </span>
          <button className="comment-reply-btn" data-comment-id={c.id} data-user-name={c.user_name} onClick={() => onReply(c)}>
            <i className="fa fa-reply"></i> 回复
          </button>
          {canDelete && (
            <button className="comment-delete-btn" title="删除" onClick={() => onDelete(c.id)}>
              <i className="fa fa-trash-o"></i>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 评论区（与 legacy renderPostDetail 评论部分 1:1）：
 * 根评论（无 parent）+ 回复分组（多层归并到根），默认展示最近2条，其余折叠。
 */
export default function CommentSection({
  comments,
  userId,
  inputRef,
  replyTo,
  setReplyTo,
  onChangeReplyText,
  onSubmit,
  onDelete,
}: {
  comments: Comment[];
  userId: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  replyTo: { id: string; name: string } | null;
  setReplyTo: (v: { id: string; name: string } | null) => void;
  onChangeReplyText: (text: string) => void;
  onSubmit: () => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { mainComments, replyMap, parentMap } = useMemo(() => {
    const parentMap: Record<string, Comment> = {};
    comments.forEach((c) => {
      parentMap[c.id] = c;
    });
    const replyMap: Record<string, Comment[]> = {};
    comments.forEach((c) => {
      if (!c.parent_id) return;
      let rootId = c.parent_id;
      let visited = 0;
      while (parentMap[rootId] && parentMap[rootId].parent_id && visited < 50) {
        rootId = parentMap[rootId].parent_id!;
        visited++;
      }
      if (!replyMap[rootId]) replyMap[rootId] = [];
      replyMap[rootId].push(c);
    });
    Object.keys(replyMap).forEach((rootId) => {
      replyMap[rootId].sort((a, b) => new Date(a.created_at || "").getTime() - new Date(b.created_at || "").getTime());
    });
    return { mainComments: comments.filter((c) => !c.parent_id).reverse(), replyMap, parentMap };
  }, [comments]);

  const startingReply = (c: Comment) => {
    setReplyTo({ id: c.id, name: c.user_name || "匿名" });
    onChangeReplyText(`@${c.user_name} `);
    inputRef.current?.focus();
  };

  return (
    <>
      <div className="comment-section-title">评论区</div>
      <div className="comment-input-bar">
        {replyTo && (
          <div className="comment-reply-indicator">
            <span>回复 <b className="Username">{replyTo.name}</b></span>
            <button onClick={() => setReplyTo(null)}><i className="fa fa-times"></i></button>
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          id="comment-input"
          placeholder={replyTo ? `回复 ${replyTo.name}...` : "写下你的评论..."}
          maxLength={500}
          onChange={(e) => onChangeReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <button className="comment-send-btn" onClick={onSubmit}>发送</button>
      </div>
      <div className="comment-list" id="comment-list">
        {comments.length === 0 ? (
          <div className="comment-empty">暂无评论，快来抢沙发~</div>
        ) : mainComments.map((c) => {
          const replies = replyMap[c.id] || [];
          const total = replies.length;
          const visibleCount = Math.min(total, 2);
          const visibleReplies = replies.slice(total - visibleCount, total);
          const hiddenReplies = replies.slice(0, total - visibleCount);
          return (
            <div key={c.id}>
              <CommentItem
                c={c}
                canDelete={!!userId && userId === c.user_id}
                userId={userId}
                onReply={startingReply}
                onDelete={onDelete}
              />
              {replies.length > 0 && (
                <div className="comment-replies">
                  {visibleReplies.map((r) => (
                    <CommentItem
                      key={r.id}
                      c={r}
                      parent={parentMap[r.parent_id!]}
                      isReply
                      canDelete={!!userId && userId === r.user_id}
                      userId={userId}
                      onReply={startingReply}
                      onDelete={onDelete}
                    />
                  ))}
                  {hiddenReplies.length > 0 && (
                    <>
                      <button className="comment-replies-toggle" data-parent-id={c.id} onClick={() => setExpanded((p) => ({ ...p, [c.id]: !p[c.id] }))}>
                        <i className="fa fa-chevron-down"></i> 展开{hiddenReplies.length}条回复
                      </button>
                      <div className={`comment-replies-hidden ${expanded[c.id] ? "" : ""}`} data-parent-id={c.id} style={{ display: expanded[c.id] ? "block" : "none" }}>
                        {hiddenReplies.map((r) => (
                          <CommentItem
                            key={r.id}
                            c={r}
                            parent={parentMap[r.parent_id!]}
                            isReply
                            canDelete={!!userId && userId === r.user_id}
                            userId={userId}
                            onReply={startingReply}
                            onDelete={onDelete}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
