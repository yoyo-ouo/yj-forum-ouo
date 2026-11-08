import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { shareContent } from "../lib/native";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import {
  AppBar,
  Avatar,
  Cell,
  Empty,
  IconButton,
  Screen,
  Segmented,
  Sheet,
  Skeletons,
} from "../components/mobile";
import { RichContent } from "../components/ui";
import { Icon } from "../components/icons";
import { categoryLabel, stripHtml, timeAgo } from "../lib/format";
import type { Post } from "../lib/types";

type ProfileTab = "posts" | "favorites" | "comments" | "characters";

/* ======================= 会馆色（与 guilds.tsx 同口径） ======================= */

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const DEFAULT_THEME = "#6A8C89";

function themeColor(color?: string | null): string {
  const value = (color || "").trim();
  return HEX_COLOR_RE.test(value) ? value : DEFAULT_THEME;
}

function themeTint(color?: string | null, alpha = "26"): string {
  return themeColor(color) + alpha;
}

function parseHex(hex?: string | null): [number, number, number] | null {
  const value = (hex || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(value)) {
    return [parseInt(value[0] + value[0], 16), parseInt(value[1] + value[1], 16), parseInt(value[2] + value[2], 16)];
  }
  if (/^[0-9a-f]{6}$/i.test(value)) {
    return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
  }
  return null;
}

function isLightHex(hex?: string | null, threshold = 0.35): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return true;
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  return luminance > threshold;
}

function themeInk(color?: string | null): string {
  const value = themeColor(color);
  const rgb = parseHex(value);
  if (!rgb || !isLightHex(value)) return value;
  const mix = (channel: number) => Math.round(channel * 0.45);
  return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/* ======================= 帖子卡（紧凑） ======================= */

function UserPostCard({
  post,
  expanded,
  onOpen,
  onToggle,
}: {
  post: Post;
  expanded?: { html: string; format: string };
  onOpen: () => void;
  onToggle: () => void;
}) {
  const summary = stripHtml(post.summary || post.content || "");
  const guildName = post.user_guild_name || post.guild_name || "";
  const meta = [
    categoryLabel(post.category),
    timeAgo(post.published_at || post.created_at),
    `${post.views ?? 0} 阅`,
    `${post.likes ?? 0} 赞`,
    `${post.comment_count ?? 0} 评`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="us-post">
      <button type="button" className="us-post-hit" onClick={onOpen}>
        <span className="us-post-title">{post.title || "无标题帖子"}</span>
        {summary ? <span className="us-post-summary">{summary}</span> : null}
      </button>
      <div className="us-post-foot">
        <span className="us-post-meta">
          {meta}
          {guildName ? ` · ${guildName}` : ""}
        </span>
        <button type="button" className="us-post-more" onClick={onToggle}>
          {expanded ? "收起" : "展开全文"}
        </button>
      </div>
      {expanded ? (
        <div className="us-post-full">
          <RichContent html={expanded.html} format={expanded.format} />
        </div>
      ) : null}
    </article>
  );
}

/* ======================= 评论卡 ======================= */

function UserCommentCard({ comment, onOpen }: { comment: any; onOpen: () => void }) {
  const postTitle = comment?.post_title ? String(comment.post_title) : "";
  return (
    <button type="button" className="us-comment" onClick={onOpen}>
      <span className="us-comment-ctx">{postTitle ? `在 ${postTitle} 的帖子下` : "在一条帖子下"}</span>
      <span className="us-comment-body">{stripHtml(comment?.content || "")}</span>
      <span className="us-comment-time">{timeAgo(comment?.created_at)}</span>
    </button>
  );
}

/* ======================= 角色卡 ======================= */

function UserCharacterCard({ item, onOpen }: { item: any; onOpen: () => void }) {
  return (
    <button type="button" className="us-char" onClick={onOpen}>
      <span className="us-char-main">
        <span className="us-char-name">{item?.name || "未命名角色"}</span>
        <span className="us-char-sub">{item?.title || item?.intro || "角色设定卡"}</span>
      </span>
      <span className={`us-char-badge ${item?.is_public ? "on" : ""}`.trim()}>
        {item?.is_public ? "公开" : "草稿"}
      </span>
      <Icon name="forward" size={16} className="us-chev" />
    </button>
  );
}

/* ======================= 用户主页 ======================= */

export function UserScreen({ id, initialTab = "posts" }: { id?: string | number; initialTab?: ProfileTab }) {
  const me = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { push } = useNav();
  const userId = String(id || me?.id || "");
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, { html: string; format: string }>>({});
  const [comments, setComments] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const profile = useQuery({ queryKey: ["profile", userId], queryFn: () => api.user(userId), enabled: Boolean(userId) });
  const data = profile.data;
  const user = data?.user;
  const isSelf = Boolean(data?.is_self || me?.id === userId);

  const loadPosts = async (nextPage: number, replace = false) => {
    setLoadingMore(true);
    if (replace) setListLoading(true);
    try {
      const res = await api.userPosts(userId, nextPage, 20);
      setPosts((current) => (replace ? res.posts || [] : [...current, ...(res.posts || [])]));
      setPage(nextPage);
      setHasMore(Boolean(res.has_more));
    } catch (error) {
      showToast(errorText(error, "加载失败"), "error");
    } finally {
      setLoadingMore(false);
      setListLoading(false);
    }
  };

  const loadFavorites = async (nextPage: number, replace = false) => {
    setLoadingMore(true);
    if (replace) setListLoading(true);
    try {
      const res = await api.userFavorites(userId, nextPage, 20);
      setPosts((current) => (replace ? res.posts || [] : [...current, ...(res.posts || [])]));
      setPage(nextPage);
      setHasMore(Boolean(res.has_more));
    } catch (error) {
      showToast(errorText(error, "加载收藏失败"), "error");
    } finally {
      setLoadingMore(false);
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    setPosts([]);
    setComments([]);
    setCharacters([]);
    setPage(1);
    setHasMore(false);
    setListLoading(true);
    if (tab === "posts") void loadPosts(1, true);
    else if (tab === "favorites") void loadFavorites(1, true);
    else if (tab === "comments") {
      void api
        .userComments(userId, 1, 50)
        .then((res) => setComments(res.comments || []))
        .catch((error) => showToast(errorText(error, "加载评论失败"), "error"))
        .finally(() => setListLoading(false));
    } else if (tab === "characters") {
      const request = isSelf ? api.characterSheetsMine() : api.characterSheetsUser(userId);
      void request
        .then((res) => setCharacters(res.items || []))
        .catch(() => setCharacters([]))
        .finally(() => setListLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, userId, isSelf]);

  const expand = async (post: Post) => {
    if (expanded[post.id]) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[post.id];
        return next;
      });
      return;
    }
    try {
      const res = await api.postDetail(post.id);
      setExpanded((current) => ({ ...current, [post.id]: { html: res.post.content || "", format: res.post.content_format || "html" } }));
    } catch (error) {
      showToast(errorText(error, "加载正文失败"), "error");
    }
  };

  const toggleFollow = async () => {
    if (!me) {
      showToast("请先登录后再关注", "info");
      push("auth");
      return;
    }
    setFollowBusy(true);
    try {
      const res = await api.follow(userId);
      showToast(res.following ? "已关注" : "已取消关注");
      await profile.refetch();
    } catch (error) {
      showToast(errorText(error, "操作失败"), "error");
    } finally {
      setFollowBusy(false);
    }
  };

  const shareProfile = async () => {
    try {
      await shareContent({
        text: `${user?.name || "论坛用户"} · 妖精论坛`,
        url: `https://www.yjlt.top/users/${encodeURIComponent(userId)}`,
      });
    } catch {
      showToast("分享未完成", "info");
    }
  };

  if (profile.isLoading) {
    return (
      <Screen appbar={<AppBar back title="" />}>
        <Skeletons count={3} />
      </Screen>
    );
  }

  if (!user) {
    return (
      <Screen appbar={<AppBar back title="" />}>
        <Empty icon="user" title="用户不存在" />
      </Screen>
    );
  }

  const stats = data?.stats;
  const follow = data?.follow_stats;
  const tabs: { key: ProfileTab; label: string }[] = isSelf
    ? [
        { key: "posts", label: "帖子" },
        { key: "favorites", label: "收藏" },
        { key: "comments", label: "评论" },
        { key: "characters", label: "角色" },
      ]
    : [
        { key: "posts", label: "帖子" },
        { key: "characters", label: "角色" },
      ];

  const statItems: { label: string; value: number }[] = [
    { label: "帖子", value: Number(stats?.post_count ?? 0) },
    { label: "关注", value: Number(follow?.following_count ?? 0) },
    { label: "粉丝", value: Number(follow?.follower_count ?? 0) },
    { label: "获赞", value: Number(stats?.total_likes ?? 0) },
  ];

  return (
    <Screen
      appbar={<AppBar back title="" actions={<IconButton icon="more" label="更多" onClick={() => setMoreOpen(true)} />} />}
    >
      <section className="us-card">
        <div className="us-top">
          <Avatar src={user.avatar} name={user.name} size={64} />
          <div className="us-id">
            <h1 className="us-name">{user.name}</h1>
            <div className="us-chips">
              {data?.guild?.name ? (
                <span
                  className="us-chip"
                  style={{ background: themeTint(data.guild.theme_color, "26"), color: themeInk(data.guild.theme_color) }}
                >
                  <Icon name="home" size={11} />
                  {data.guild.name}
                  {data.is_leader ? " · 馆长" : ""}
                </span>
              ) : null}
              {user.prefix ? (
                <span className="us-chip">
                  <Icon name="sparkle" size={11} />
                  {user.prefix}
                </span>
              ) : null}
              <span className="us-chip">
                <Icon name="sparkle" size={11} />灵力 {user.spirit ?? 0}
              </span>
            </div>
          </div>
          {!isSelf ? (
            <button
              type="button"
              className={`m-btn m-btn--pill us-follow ${data?.is_following ? "m-btn--ghost" : "m-btn--primary"}`.trim()}
              disabled={followBusy}
              onClick={() => void toggleFollow()}
            >
              {followBusy ? "处理中…" : data?.is_following ? "已关注" : "关注"}
            </button>
          ) : null}
        </div>

        <p className={`us-intro ${user.intro ? "" : "us-intro--empty"}`.trim()}>
          {user.intro || "这个人很懒，什么都没留下~"}
        </p>

        <div className="us-stats">
          {statItems.map((item) => (
            <div className="us-stat" key={item.label}>
              <b>{item.value}</b>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="us-tabs">
        <Segmented<ProfileTab> items={tabs} value={tab} onChange={setTab} />
      </div>

      {listLoading ? <Skeletons count={3} /> : null}

      {!listLoading && (tab === "posts" || tab === "favorites") ? (
        posts.length === 0 ? (
          <Empty icon="edit" title={tab === "favorites" ? "还没有收藏" : "还没有发布帖子"} />
        ) : (
          <div className="us-list">
            {posts.map((post) => (
              <UserPostCard
                key={post.id}
                post={post}
                expanded={expanded[post.id]}
                onOpen={() => push("post", { id: post.id })}
                onToggle={() => void expand(post)}
              />
            ))}
            {hasMore ? (
              <button
                type="button"
                className="m-more us-more"
                disabled={loadingMore}
                onClick={() => {
                  if (tab === "favorites") void loadFavorites(page + 1);
                  else void loadPosts(page + 1);
                }}
              >
                {loadingMore ? "加载中…" : "加载更多"}
              </button>
            ) : (
              <div className="m-end">— 到底了 —</div>
            )}
          </div>
        )
      ) : null}

      {!listLoading && tab === "comments" ? (
        comments.length === 0 ? (
          <Empty icon="comment" title="还没有评论" />
        ) : (
          <div className="us-list">
            {comments.map((comment) => (
              <UserCommentCard
                key={comment.id}
                comment={comment}
                onOpen={() => push("post", { id: comment.post_id })}
              />
            ))}
            <div className="m-end">— 到底了 —</div>
          </div>
        )
      ) : null}

      {!listLoading && tab === "characters" ? (
        characters.length === 0 ? (
          <Empty icon="user" title="还没有角色设定" />
        ) : (
          <div className="us-list">
            {characters.map((item) => (
              <UserCharacterCard
                key={item.id}
                item={item}
                onOpen={() => push("character-detail", { id: item.id })}
              />
            ))}
            <div className="m-end">— 到底了 —</div>
          </div>
        )
      ) : null}

      <Sheet open={moreOpen} title="更多" onClose={() => setMoreOpen(false)}>
        <div className="m-list us-sheet-list">
          <Cell
            icon="share"
            label="分享主页"
            chevron={false}
            onClick={() => { setMoreOpen(false); void shareProfile(); }}
          />
          {!isSelf ? (
            <Cell
              icon={data?.is_following ? "close" : "user"}
              label={data?.is_following ? "取消关注" : "关注"}
              chevron={false}
              onClick={() => { setMoreOpen(false); void toggleFollow(); }}
            />
          ) : null}
          {isSelf ? (
            <Cell icon="settings" label="设置" onClick={() => { setMoreOpen(false); push("settings"); }} />
          ) : null}
          {isSelf ? (
            <Cell icon="edit" label="发新帖" onClick={() => { setMoreOpen(false); push("compose"); }} />
          ) : null}
        </div>
      </Sheet>
    </Screen>
  );
}
