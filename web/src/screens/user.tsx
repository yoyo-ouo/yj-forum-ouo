import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { Avatar, EmptyState, LoadMore, Loading, RichContent, SpaceBadge, TopBar } from "../components/ui";
import { categoryLabel, timeAgo } from "../lib/format";
import type { Post } from "../lib/types";

type ProfileTab = "posts" | "favorites" | "comments" | "characters";

export function UserScreen({ id, initialTab = "posts" }: { id?: string | number; initialTab?: ProfileTab }) {
  const me = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { push } = useNav();
  const userId = String(id || me?.id || "");
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, { html: string; format: string }>>({});
  const [comments, setComments] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);

  const profile = useQuery({ queryKey: ["profile", userId], queryFn: () => api.user(userId), enabled: Boolean(userId) });
  const data = profile.data;
  const user = data?.user;
  const isSelf = Boolean(data?.is_self || me?.id === userId);

  const loadPosts = async (nextPage: number, replace = false) => {
    setLoadingMore(true);
    try {
      const res = await api.userPosts(userId, nextPage, 20);
      setPosts((current) => (replace ? res.posts || [] : [...current, ...(res.posts || [])]));
      setPage(nextPage);
      setHasMore(Boolean(res.has_more));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "加载失败", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const loadFavorites = async (nextPage: number, append = true) => {
    setLoadingMore(true);
    try {
      const res = await api.userFavorites(userId, nextPage, 20);
      setPosts((current) => (append ? [...current, ...(res.posts || [])] : res.posts || []));
      setPage(nextPage);
      setHasMore(Boolean(res.has_more));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "加载收藏失败", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    setPosts([]);
    setComments([]);
    setCharacters([]);
    setPage(1);
    setHasMore(false);
    if (tab === "posts") void loadPosts(1, true);
    else if (tab === "favorites" && isSelf) void loadFavorites(1, false);
    else if (tab === "comments" && isSelf) void api.userComments(userId, 1, 50).then((res) => setComments(res.comments || [])).catch(() => undefined);
    else if (tab === "characters") {
      const request = isSelf ? api.characterSheetsMine() : api.characterSheetsUser(userId);
      void request.then((res) => setCharacters(res.items || [])).catch(() => setCharacters([]));
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
      showToast(error instanceof Error ? error.message : "加载正文失败", "error");
    }
  };

  const toggleFollow = async () => {
    try {
      const res = await api.follow(userId);
      showToast(res.following ? "已关注" : "已取消关注");
      void profile.refetch();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "操作失败", "error");
    }
  };

  if (profile.isLoading) return <div className="screen"><TopBar title="用户主页" back /><Loading /></div>;
  if (!user) return <div className="screen"><TopBar title="用户主页" back /><EmptyState text="用户不存在" /></div>;

  const stats = data?.stats;
  const follow = data?.follow_stats;

  return (
    <div className="screen">
      <TopBar title={user.name} back actions={isSelf ? <button className="icon-btn" onClick={() => push("settings")}><i className="fa fa-cog" /></button> : null} />
      <div className="user-profile-page">
        <div className="user-profile-card">
          <div className="user-profile-avatar-wrapper">
            <div className="user-profile-avatar"><Avatar src={user.avatar} name={user.name} size={80} /></div>
          </div>
          <div className="user-profile-info">
            <h2><span id="user-profile-name">{user.name}</span></h2>
            <div className="user-profile-meta">
              {data?.guild?.name ? <span className="user-meta-item"><i className="fa fa-home" /> {data.guild.name}{data.is_leader ? " · 馆长" : ""}</span> : null}
              {user.prefix ? <span className="user-meta-item"><i className="fa fa-tag" /> {user.prefix}</span> : null}
              <span className="user-meta-item"><i className="fa fa-star-o" /> 灵力 {user.spirit ?? 0}</span>
            </div>
            {user.intro ? <div className="user-profile-intro">{user.intro}</div> : null}
          </div>
          <div className="user-profile-stats">
            <div className="stat-item"><span className="stat-number">{stats?.post_count ?? 0}</span><span className="stat-label">帖子</span></div>
            <div className="stat-item"><span className="stat-number">{stats?.total_likes ?? 0}</span><span className="stat-label">获赞</span></div>
            <div className="stat-item"><span className="stat-number">{follow?.following_count ?? 0}</span><span className="stat-label">关注</span></div>
            <div className="stat-item"><span className="stat-number">{follow?.follower_count ?? 0}</span><span className="stat-label">粉丝</span></div>
          </div>
        </div>

        <div className="user-profile-tabs">
          {([["posts", "帖子"], ["characters", "角色"], ...(isSelf ? [["favorites", "收藏"], ["comments", "评论"]] : [])] as [ProfileTab, string][]).map(([key, label]) => (
            <button key={key} className={`profile-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>
          ))}
          {isSelf ? (
            <button className="profile-tab profile-tab-create" onClick={() => push("compose")}><i className="fa fa-pencil" /> 发新帖</button>
          ) : (
            <button className={`profile-tab profile-tab-create`} onClick={() => void toggleFollow()}>{data?.is_following ? "已关注" : "关注"}</button>
          )}
        </div>

        <div className="user-profile-content">
          {tab === "posts" || tab === "favorites" ? (
            posts.length === 0 ? <EmptyState text={tab === "favorites" ? "还没有收藏" : "还没有发布帖子"} /> : (
              <div className="user-posts-list">
                {posts.map((post) => (
                  <div key={post.id} className="post-item">
                    <div className="post-item-header">
                      <div className="post-item-avatar"><Avatar src={post.user_avatar || post.author_avatar} name={post.user_name || post.author_name} size={40} /></div>
                      <div className="post-item-header-body">
                        <h3 className="post-item-title" onClick={() => push("post", { id: post.id })}>{post.title}</h3>
                        <div className="post-item-sub-meta">
                          <span>{categoryLabel(post.category)}</span>
                          <span>·</span>
                          <span>{timeAgo(post.published_at || post.created_at)}</span>
                          {post.user_guild_name ? <SpaceBadge name={post.user_guild_name} color={post.user_guild_theme_color} /> : null}
                        </div>
                      </div>
                    </div>
                    <p className={`post-item-summary ${expanded[post.id] ? "post-item-summary-expanded" : ""}`} onClick={() => push("post", { id: post.id })}>
                      {(post.summary || "").replace(/<[^>]+>/g, "")}
                    </p>
                    {expanded[post.id] ? <div className="post-item-full"><RichContent html={expanded[post.id].html} format={expanded[post.id].format} /></div> : null}
                    <div className="post-item-footer">
                      <div className="post-item-stats">
                        <span><i className="fa fa-eye" /> {post.views ?? 0}</span>
                        <span><i className="fa fa-thumbs-up" /> {post.likes ?? 0}</span>
                        <span><i className="fa fa-comment" /> {post.comment_count ?? 0}</span>
                      </div>
                      <button className="post-item-expand-btn" onClick={() => void expand(post)}>{expanded[post.id] ? "收起" : "展开全文"}</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : null}

          {tab === "comments" ? (
            comments.length === 0 ? <EmptyState text="还没有评论" /> : (
              <div className="user-posts-list">
                {comments.map((comment) => (
                  <div key={comment.id} className="post-item" onClick={() => push("post", { id: comment.post_id })}>
                    <h3 className="post-item-title">{comment.post_title || "帖子"}</h3>
                    <p className="post-item-summary">{(comment.content || "").replace(/<[^>]+>/g, "")}</p>
                    <div className="post-item-footer"><span>{timeAgo(comment.created_at)}</span></div>
                  </div>
                ))}
              </div>
            )
          ) : null}

          {tab === "characters" ? (
            characters.length === 0 ? <EmptyState text="还没有角色设定" /> : (
              <div className="user-posts-list">
                {characters.map((item) => (
                  <div key={item.id} className="post-item" onClick={() => push("character-detail", { id: item.id })}>
                    <h3 className="post-item-title">{item.name || "未命名角色"}</h3>
                    <p className="post-item-summary">{item.title || item.intro || "角色设定卡"}</p>
                    <div className="post-item-footer"><span className="post-item-category">{item.is_public ? "公开" : "草稿"}</span></div>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </div>

        {tab === "posts" ? <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void loadPosts(page + 1)} /> : null}
        {tab === "favorites" ? <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void loadFavorites(page + 1)} /> : null}
      </div>
    </div>
  );
}
