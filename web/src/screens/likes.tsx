import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { AppBar, Avatar, Empty, Screen, Skeletons } from "../components/mobile";
import { timeAgo } from "../lib/format";
import type { LikeMessage } from "../lib/types";

const PAGE_SIZE = 20;

function likeVerb(targetType?: string): string {
  if (targetType === "post") return "赞了你的帖子";
  if (targetType === "character") return "赞了你的设定";
  if (targetType === "comment") return "赞了你的评论";
  return "赞了你";
}

function likeKind(targetType?: string): string {
  if (targetType === "post") return "帖子";
  if (targetType === "character") return "设定";
  return "评论";
}

/** 点赞目标摘要：帖子标题 / 评论正文摘录 / 设定名 */
function likeTargetText(item: LikeMessage): string {
  if (item.target_type === "character") return item.target_title || "设定";
  if (item.target_type === "comment") return item.comment_excerpt || item.post_title || "";
  return item.post_title || "";
}

/** 谁赞了我（仅本人） */
export function LikesScreen() {
  const user = useApp((state) => state.user);
  const showToast = useApp((state) => state.showToast);
  const { push } = useNav();
  const [items, setItems] = useState<LikeMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (next?: string | null, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const res = await api.likesMe(next || undefined, PAGE_SIZE);
      const incoming = Array.isArray(res?.items) ? res.items : [];
      setItems((current) => {
        if (!append) return incoming;
        const known = new Set(current.map((item) => String(item.id)));
        return [...current, ...incoming.filter((item) => !known.has(String(item.id)))];
      });
      setHasMore(Boolean(res?.has_more));
      setCursor(res?.next_cursor ? String(res.next_cursor) : null);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "加载失败";
      if (append) {
        // 翻页失败不覆盖已加载列表，只提示
        showToast(message, "error");
      } else {
        setError(message);
        setItems([]);
        showToast(message, "error");
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      return;
    }
    setItems([]);
    setCursor(null);
    setHasMore(false);
    void load(null, false);
  }, [load, user?.id]);

  const openTarget = (item: LikeMessage) => {
    if (item.target_type === "character" && item.target_id) {
      push("character-detail", { id: String(item.target_id) });
      return;
    }
    if (item.post_id) push("post", { id: String(item.post_id) });
  };

  const appbar = <AppBar back title="谁赞了我" />;

  if (!user) {
    return (
      <Screen appbar={appbar}>
        <Empty
          icon="heart"
          title="登录后查看谁赞了你"
          hint="收到的点赞会显示在这里"
          action={
            <button type="button" className="m-btn m-btn--primary" onClick={() => push("auth")}>
              去登录
            </button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen appbar={appbar} bodyClassName="lk-body">
      {loading ? (
        <Skeletons count={5} />
      ) : error ? (
        <Empty
          icon="info"
          title="点赞消息加载失败"
          hint={error}
          action={
            <button type="button" className="m-btn m-btn--primary m-btn--sm" onClick={() => void load(null, false)}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <Empty icon="heart" title="还没有收到点赞" hint="有人点赞你的帖子、评论或设定时会出现在这里" />
      ) : (
        <>
          <div className="lk-list">
            {items.map((item) => {
              const actor = item.actor?.name || "有人";
              const target = likeTargetText(item);
              const clickable = Boolean(item.post_id || (item.target_type === "character" && item.target_id));
              return (
                <div
                  key={item.id}
                  className={`lk-item${clickable ? " is-link" : ""}`}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={`${actor} ${likeVerb(item.target_type)}`}
                  onClick={clickable ? () => openTarget(item) : undefined}
                  onKeyDown={
                    clickable
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openTarget(item);
                          }
                        }
                      : undefined
                  }
                >
                  <Avatar src={item.actor?.avatar} name={actor} size={40} />
                  <div className="lk-text">
                    <div className="lk-line">
                      <b>{actor}</b> {likeVerb(item.target_type)}
                    </div>
                    {target ? <div className="lk-target">{target}</div> : null}
                    <div className="lk-meta">
                      <span className="lk-kind">{likeKind(item.target_type)}</span>
                      <span>{timeAgo(item.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {hasMore ? (
            <button
              type="button"
              className="m-more lk-more"
              disabled={loadingMore}
              onClick={() => void load(cursor, true)}
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </button>
          ) : (
            <div className="lk-end">— 到底了 —</div>
          )}
        </>
      )}
    </Screen>
  );
}
