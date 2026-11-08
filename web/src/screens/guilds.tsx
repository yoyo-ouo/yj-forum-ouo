import React, { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { Avatar, EmptyState, LoadMore, Loading, PostCard, RichContent, TopBar } from "../components/ui";
import { avatarUrl, formatDate } from "../lib/format";
import type { Post } from "../lib/types";

type GuildTab = "feed" | "members" | "leader" | "intro";

const GUILD_TABS: [GuildTab, string][] = [
  ["feed", "动态"],
  ["members", "成员"],
  ["leader", "馆长"],
  ["intro", "介绍"],
];

/** 会馆主题色渐变；未配置主题色时沿用 app.css 的默认渐变。 */
function coverStyle(themeColor?: string | null): React.CSSProperties | undefined {
  if (!themeColor) return undefined;
  return { background: `linear-gradient(135deg, ${themeColor}, var(--color-secondary))` };
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 会馆列表：渐变封面 + 简介 + 成员/帖子数，点击进入会馆详情。 */
export function GuildsScreen() {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const guildsQuery = useQuery({ queryKey: ["guilds"], queryFn: () => api.guilds(), staleTime: 60_000 });

  useEffect(() => {
    if (guildsQuery.error) showToast(errorText(guildsQuery.error, "会馆列表加载失败"), "error");
  }, [guildsQuery.error, showToast]);

  const guilds: any[] = guildsQuery.data?.guilds || [];

  return (
    <div className="screen">
      <TopBar title="会馆" back />
      {guildsQuery.isLoading ? <Loading /> : null}
      {!guildsQuery.isLoading && guilds.length === 0 ? (
        <EmptyState
          text={guildsQuery.isError ? "会馆列表加载失败" : "还没有会馆"}
          action={
            guildsQuery.isError ? (
              <button className="btn ghost" onClick={() => void guildsQuery.refetch()}>重新加载</button>
            ) : undefined
          }
        />
      ) : null}
      {guilds.map((guild: any, index: number) => {
        const slug = guild?.slug || (guild?.uuid ? String(guild.uuid) : "");
        const name = guild?.name || "未命名会馆";
        const postCount = guild?.post_count ?? guild?.posts_count ?? guild?.article_count;
        return (
          <article
            key={slug || guild?.id || index}
            className="guild-card"
            onClick={() => {
              if (slug) push("guild", { slug });
            }}
          >
            <div className="guild-cover" style={coverStyle(guild?.theme_color)}>
              <span>{name}</span>
            </div>
            <p className="guild-desc">{guild?.intro || "这个会馆还没有简介"}</p>
            <div className="guild-meta">
              <span>👥 {guild?.member_count ?? 0} 成员</span>
              <span>📝 {postCount ?? 0} 帖</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** 会馆详情：信息卡 + 动态/成员/馆长/介绍四个 tab。 */
export function GuildDetailScreen({ slug }: { slug?: string }) {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const guildSlug = String(slug || "");
  const [tab, setTab] = useState<GuildTab>("feed");

  const [items, setItems] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [members, setMembers] = useState<any[]>([]);
  const [memberPage, setMemberPage] = useState(1);
  const [memberHasMore, setMemberHasMore] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberLoadingMore, setMemberLoadingMore] = useState(false);
  const [memberLoadedFor, setMemberLoadedFor] = useState("");

  const guildQuery = useQuery({
    queryKey: ["guild", guildSlug],
    queryFn: () => api.guild(guildSlug),
    enabled: Boolean(guildSlug),
  });
  const leaderQuery = useQuery({
    queryKey: ["guild-leader", guildSlug],
    queryFn: () => api.guildLeader(guildSlug),
    enabled: Boolean(guildSlug) && tab === "leader",
  });
  const introQuery = useQuery({
    queryKey: ["guild-intro", guildSlug],
    queryFn: () => api.guildIntro(guildSlug),
    enabled: Boolean(guildSlug) && tab === "intro",
  });

  useEffect(() => {
    if (guildQuery.error) showToast(errorText(guildQuery.error, "会馆加载失败"), "error");
  }, [guildQuery.error, showToast]);
  useEffect(() => {
    if (leaderQuery.error) showToast(errorText(leaderQuery.error, "馆长介绍加载失败"), "error");
  }, [leaderQuery.error, showToast]);
  useEffect(() => {
    if (introQuery.error) showToast(errorText(introQuery.error, "会馆介绍加载失败"), "error");
  }, [introQuery.error, showToast]);

  const loadFeed = useCallback(
    async (nextPage: number, replace = false) => {
      if (!guildSlug) return;
      if (replace) setFeedLoading(true);
      else setLoadingMore(true);
      try {
        const res = await api.guildFeed(guildSlug, nextPage, 20);
        const incoming = res.items || [];
        setItems((current) => (replace ? incoming : [...current, ...incoming]));
        setPage(nextPage);
        setHasMore(Boolean(res.has_more));
      } catch (error) {
        showToast(errorText(error, "动态加载失败"), "error");
      } finally {
        setFeedLoading(false);
        setLoadingMore(false);
      }
    },
    [guildSlug, showToast],
  );

  const loadMembers = useCallback(
    async (nextPage: number, replace = false) => {
      if (!guildSlug) return;
      if (replace) setMemberLoading(true);
      else setMemberLoadingMore(true);
      try {
        const res = await api.guildMembers(guildSlug, nextPage, 24);
        const incoming = res.members || [];
        setMembers((current) => (replace ? incoming : [...current, ...incoming]));
        setMemberPage(nextPage);
        setMemberHasMore(Boolean(res.has_more));
      } catch (error) {
        showToast(errorText(error, "成员加载失败"), "error");
      } finally {
        setMemberLoading(false);
        setMemberLoadingMore(false);
        setMemberLoadedFor(guildSlug);
      }
    },
    [guildSlug, showToast],
  );

  useEffect(() => {
    if (!guildSlug) return;
    setItems([]);
    setPage(1);
    setHasMore(false);
    setFeedLoading(true);
    void loadFeed(1, true);
  }, [guildSlug, loadFeed]);

  useEffect(() => {
    if (tab !== "members" || !guildSlug) return;
    if (memberLoadedFor === guildSlug) return;
    setMembers([]);
    setMemberPage(1);
    setMemberHasMore(false);
    void loadMembers(1, true);
  }, [tab, guildSlug, memberLoadedFor, loadMembers]);

  const guild = guildQuery.data?.guild;
  const myState = guildQuery.data?.my_state;
  const guildName = guild?.name || "会馆";

  const leaderPage = leaderQuery.data;
  const leader = leaderPage?.leader;
  const leaderBio = leaderPage?.leader_bio || leader?.bio || leader?.intro || "";
  const leaderContent = leaderPage?.content || leaderPage?.content_html || "";
  const leaderFormat = leaderPage?.content_format || "html";

  const introContent = introQuery.data?.content || introQuery.data?.content_html || "";
  const introFormat = introQuery.data?.content_format || "html";

  const selectTab = (next: GuildTab) => {
    if (next === "members" && memberLoadedFor !== guildSlug) setMemberLoading(true);
    setTab(next);
  };

  return (
    <div className="screen">
      <TopBar title={guildName} back />
      {guildQuery.isLoading ? <Loading /> : null}
      {!guildQuery.isLoading && !guild ? (
        <EmptyState
          text={guildQuery.isError ? "会馆加载失败" : "会馆不存在或已被解散"}
          action={
            guildQuery.isError ? (
              <button className="btn ghost" onClick={() => void guildQuery.refetch()}>重新加载</button>
            ) : undefined
          }
        />
      ) : null}
      {guild ? (
        <>
          <div className="guild-card" style={{ marginTop: 12 }}>
            <div className="guild-cover" style={coverStyle(guild?.theme_color)}>
              <span>{guildName}</span>
            </div>
            <p className="guild-desc">{guild?.intro || "这个会馆还没有简介"}</p>
            <div className="guild-meta">
              <span>👥 {guild?.member_count ?? 0} 成员</span>
              {guild?.leader?.name ? <span>馆长 {guild.leader.name}</span> : null}
              {myState?.is_leader ? <span className="pill">馆长</span> : myState?.is_member ? <span className="pill">已加入</span> : null}
            </div>
          </div>

          <div className="tabs">
            {GUILD_TABS.map(([key, label]) => (
              <button key={key} className={`tab-item ${tab === key ? "on" : ""}`} onClick={() => selectTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "feed" ? (
            feedLoading ? (
              <Loading />
            ) : items.length === 0 ? (
              <EmptyState text="这个会馆还没有动态" />
            ) : (
              <>
                {items.map((item) => {
                  const kind = (item as any)?.type === "article" ? "article" : "post";
                  return (
                    <PostCard
                      key={`${kind}-${item.id}`}
                      post={item}
                      onOpen={() => push(kind, { id: item.id })}
                    />
                  );
                })}
                <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void loadFeed(page + 1)} />
              </>
            )
          ) : null}

          {tab === "members" ? (
            memberLoading || memberLoadedFor !== guildSlug ? (
              <Loading />
            ) : members.length === 0 ? (
              <EmptyState text="这个会馆还没有成员" />
            ) : (
              <>
                <div className="comment-list">
                  {members.map((member: any, index: number) => {
                    const isCharacter = member?.kind === "character";
                    const name = member?.character_name || member?.name || "会馆成员";
                    const targetId = isCharacter ? member?.character_id : member?.id;
                    const joinedAt = formatDate(member?.joined_at);
                    return (
                      <div
                        key={`${member?.kind || "member"}-${member?.id || index}`}
                        className="comment"
                        onClick={() => {
                          if (targetId) push(isCharacter ? "character-detail" : "user", { id: targetId });
                        }}
                      >
                        <Avatar src={member?.avatar} name={name} size={40} />
                        <div className="comment-main">
                          <div className="comment-name">
                            {name}
                            {member?.is_leader ? <span>馆长</span> : null}
                            {isCharacter ? <span>角色</span> : null}
                          </div>
                          <p className="comment-text">
                            {member?.character_title || member?.intro || member?.prefix || "会馆成员"}
                          </p>
                          {joinedAt ? (
                            <div className="comment-foot">
                              <span>{joinedAt} 加入</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <LoadMore
                  loading={memberLoadingMore}
                  hasMore={memberHasMore}
                  onClick={() => void loadMembers(memberPage + 1)}
                />
              </>
            )
          ) : null}

          {tab === "leader" ? (
            leaderQuery.isLoading ? (
              <Loading />
            ) : !leader ? (
              <EmptyState text={leaderQuery.isError ? "馆长介绍加载失败" : "这个会馆还没有馆长"} />
            ) : (
              <>
                <div className="info-card">
                  <div className="row">
                    <Avatar src={leader.avatar} name={leader.name} size={52} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="guild-name">{leader.name || "馆长"}</div>
                      <div className="small muted">{leader.title || "馆长"}</div>
                    </div>
                  </div>
                  {leaderBio ? <p className="guild-desc">「{leaderBio}」</p> : null}
                </div>
                <div className="info-card">
                  {leaderContent ? (
                    <RichContent html={leaderContent} format={leaderFormat} />
                  ) : (
                    <p className="muted small">馆长还没有留下正文。</p>
                  )}
                </div>
              </>
            )
          ) : null}

          {tab === "intro" ? (
            introQuery.isLoading ? (
              <Loading />
            ) : !introContent ? (
              <EmptyState text={introQuery.isError ? "会馆介绍加载失败" : "这个会馆还没有介绍"} />
            ) : (
              <div className="info-card">
                <RichContent html={introContent} format={introFormat} />
              </div>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** 会馆文章详情：标题 + 作者 + 时间 + 封面 + 正文。 */
export function ArticleScreen({ id }: { id?: string | number }) {
  const showToast = useApp((s) => s.showToast);
  const articleId = String(id || "");
  const articleQuery = useQuery({
    queryKey: ["article", articleId],
    queryFn: () => api.article(articleId),
    enabled: Boolean(articleId),
  });

  useEffect(() => {
    if (articleQuery.error) showToast(errorText(articleQuery.error, "文章加载失败"), "error");
  }, [articleQuery.error, showToast]);

  const article = articleQuery.data?.article;
  const authorName = article?.author?.name || article?.author_name || article?.user_name || "佚名";
  const authorAvatar = article?.author?.avatar || article?.user_avatar || "";
  const cover =
    article?.cover ||
    article?.cover_url ||
    article?.cover_image ||
    (article?.cover_file_id ? `/ov2/api/media/${article.cover_file_id}` : "");
  const content = article?.content || article?.content_html || "";
  const publishedAt = formatDate(article?.created_at || article?.updated_at);
  const articleMeta = [
    publishedAt,
    article?.guild_name || "",
    article?.views ? `${article.views} 阅读` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="screen">
      <TopBar title="文章" back />
      {articleQuery.isLoading ? <Loading /> : null}
      {!articleQuery.isLoading && !article ? (
        <EmptyState
          text={articleQuery.isError ? "文章加载失败" : "文章不存在"}
          action={
            articleQuery.isError ? (
              <button className="btn ghost" onClick={() => void articleQuery.refetch()}>重新加载</button>
            ) : undefined
          }
        />
      ) : null}
      {article ? (
        <>
          <div className="detail-head">
            <h1 className="detail-title">{article.title || "未命名文章"}</h1>
            <div className="detail-author">
              <Avatar src={authorAvatar} name={authorName} size={34} />
              <div style={{ minWidth: 0 }}>
                <div className="post-name">{authorName}</div>
                <div className="post-meta">{articleMeta}</div>
              </div>
            </div>
            {cover ? (
              <img
                src={avatarUrl(cover)}
                alt=""
                style={{ width: "100%", borderRadius: 14, display: "block", marginBottom: 12 }}
              />
            ) : null}
          </div>
          <div className="screen-pad">
            {content ? (
              <RichContent html={content} format={article.content_format} />
            ) : (
              <p className="muted small">这篇文章还没有正文。</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
