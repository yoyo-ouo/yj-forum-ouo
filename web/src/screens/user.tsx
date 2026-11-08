import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { Avatar, EmptyState, LoadMore, Loading, PostCard, RichContent, TopBar } from "../components/ui";
import { formatDate, timeAgo } from "../lib/format";
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
    if (tab === "posts") {
      void loadPosts(1, true);
    } else if (tab === "favorites" && isSelf) {
      void loadFavorites(1, false);
    } else if (tab === "comments" && isSelf) {
      void api.userComments(userId, 1, 50).then((res) => setComments(res.comments || [])).catch(() => undefined);
    } else if (tab === "characters") {
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

  return (
    <div className="screen">
      <TopBar title={user.name} back actions={isSelf ? <button className="icon-btn" onClick={() => push("settings")}>⚙</button> : null} />
      <div className="profile-hero">
        <div className="profile-top">
          <Avatar src={user.avatar} name={user.name} size={56} />
          <div style={{ flex: 1 }}>
            <div className="profile-name">{user.name}</div>
            <div className="profile-sub">{data?.guild?.name ? `${data.guild.name} · ${data.is_leader ? "馆长" : "成员"}` : "论坛用户"}{user.prefix ? ` · ${user.prefix}` : ""}</div>
          </div>
        </div>
        {user.intro ? <div className="profile-intro">{user.intro}</div> : null}
        <div className="profile-stats">
          <div><b>{data?.stats?.post_count ?? 0}</b><span>帖子</span></div>
          <div><b>{data?.stats?.total_likes ?? 0}</b><span>获赞</span></div>
          <div><b>{data?.follow_stats?.following_count ?? 0}</b><span>关注</span></div>
          <div><b>{data?.follow_stats?.follower_count ?? 0}</b><span>粉丝</span></div>
        </div>
        <div className="profile-actions">
          {isSelf ? (
            <button className="btn primary" onClick={() => push("compose")}>发新帖</button>
          ) : (
            <button className={`btn ${data?.is_following ? "ghost" : "primary"}`} onClick={() => void toggleFollow()}>{data?.is_following ? "已关注" : "关注"}</button>
          )}
          <button className="btn ghost" onClick={() => push("character")}>角色设定</button>
        </div>
      </div>

      <div className="tabs">
        {([["posts", "帖子"], ["characters", "角色"], ...(isSelf ? [["favorites", "收藏"], ["comments", "评论"]] : [])] as [ProfileTab, string][]).map(([key, label]) => (
          <button key={key} className={`tab-item ${tab === key ? "on" : ""}`} onClick={() => { setTab(key); if (key === "posts") { setPosts([]); void loadPosts(1, true); } }}>{label}</button>
        ))}
      </div>

      {tab === "posts" || tab === "favorites" ? (
        posts.length === 0 ? <EmptyState text={tab === "favorites" ? "还没有收藏" : "还没有发布帖子"} /> : (
          <>
            {posts.map((post) => (
              <div key={post.id}>
                <PostCard post={post} />
                <div style={{ margin: "-6px 14px 10px", display: "flex", justifyContent: "flex-end" }}>
                  <button className="link-btn" onClick={() => void expand(post)}>{expanded[post.id] ? "收起全文" : "展开全文"}</button>
                </div>
                {expanded[post.id] ? (
                  <div className="info-card" style={{ marginTop: -2 }}>
                    <RichContent html={expanded[post.id].html} format={expanded[post.id].format} />
                  </div>
                ) : null}
              </div>
            ))}
            {tab === "posts" ? <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void loadPosts(page + 1)} /> : null}
            {tab === "favorites" ? <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void loadFavorites(page + 1)} /> : null}
          </>
        )
      ) : null}

      {tab === "comments" ? (
        comments.length === 0 ? <EmptyState text="还没有评论" /> : comments.map((comment) => (
          <div key={comment.id} className="info-card" onClick={() => push("post", { id: comment.post_id })}>
            <h4>{comment.post_title || "帖子"}</h4>
            <p>{comment.content?.replace(/<[^>]+>/g, "")}</p>
            <div className="meta">{timeAgo(comment.created_at)}</div>
          </div>
        ))
      ) : null}

      {tab === "characters" ? (
        characters.length === 0 ? <EmptyState text="还没有角色设定" /> : characters.map((item) => (
          <div key={item.id} className="character-card" onClick={() => push("character-detail", { id: item.id })}>
            <div className="row between"><strong>{item.name || "未命名角色"}</strong><span className="small muted">{item.is_public ? "公开" : "草稿"}</span></div>
            <p className="small muted" style={{ margin: "6px 0 0" }}>{item.title || item.intro || "角色设定卡"}</p>
          </div>
        ))
      ) : null}
    </div>
  );
}
