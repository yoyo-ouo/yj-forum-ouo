import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { AppBar, Avatar, Empty, IconButton, Loader, Screen, Segmented, Sheet, Skeletons } from "../components/mobile";
import { Icon } from "../components/icons";
import { CATEGORY_LABELS, categoryColor, contrastText, stripHtml, timeAgo } from "../lib/format";
import type { Post } from "../lib/types";

type Space = "all" | "public" | "guild";

/** 公告关闭状态（按公告版本 + 文案记录，换了公告会重新出现） */
const NOTICE_KEY = "yj_feed_notice_dismissed";

/** 会馆身份色：明暗主题下都能读的淡色徽标 */
function guildTint(color?: string | null): React.CSSProperties {
  const tint = color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : "var(--color-primary)";
  return {
    background: `color-mix(in srgb, ${tint} 16%, transparent)`,
    color: `color-mix(in srgb, ${tint} 60%, var(--color-text-primary))`,
  };
}

function FeedCard({ post }: { post: Post }) {
  const { push } = useNav();
  const author = post.user_name || post.author_name || "论坛用户";
  const summary = post.summary || stripHtml(post.content || "");
  const color = categoryColor(post.category);
  const spaceName = post.guild_name || "";
  // 作者所属会馆与帖子所在会馆相同时，只展示一次，避免两个同名 chip
  const authorGuild = post.user_guild_name && post.user_guild_name !== spaceName ? post.user_guild_name : "";
  const open = () => push("post", { id: post.id });

  return (
    <article
      className="feed-card"
      role="button"
      tabIndex={0}
      aria-label={post.title}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className="feed-card-head">
        <Avatar src={post.user_avatar || post.author_avatar} name={author} size={36} />
        <div className="feed-card-who">
          <span className="feed-card-name">{author}</span>
          {authorGuild ? (
            <span className="feed-guild" style={guildTint(post.user_guild_theme_color)}>{authorGuild}</span>
          ) : null}
        </div>
        <span className="feed-card-time">{timeAgo(post.published_at || post.created_at)}</span>
      </div>
      <h3 className="feed-card-title">{post.title}</h3>
      {summary ? <p className="feed-card-summary">{summary}</p> : null}
      <div className="feed-card-foot">
        <span className="feed-cat" style={{ background: color, color: contrastText(color) }}>
          {CATEGORY_LABELS[post.category || ""] || "综合"}
        </span>
        {spaceName ? (
          <span className="feed-space" style={guildTint(post.guild_theme_color)}>
            <Icon name="home" size={11} />
            {spaceName}
          </span>
        ) : null}
        <span className="feed-stats">
          <span><Icon name="eye" size={12} />{post.views ?? 0}</span>
          <span><Icon name="like" size={12} />{post.likes ?? 0}</span>
          <span><Icon name="comment" size={12} />{post.comment_count ?? 0}</span>
        </span>
      </div>
    </article>
  );
}

export function FeedScreen() {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const [space, setSpace] = useState<Space>("all");
  const [guildId, setGuildId] = useState<number | null>(null);
  const [guildName, setGuildName] = useState("");
  const [guildOpen, setGuildOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 随机推荐（与最新流完全分离：不共用 items/page/hasMore） */
  const [randomMode, setRandomMode] = useState(false);
  const [randomItems, setRandomItems] = useState<Post[]>([]);
  const [randomLoading, setRandomLoading] = useState(false);
  const [randomFailed, setRandomFailed] = useState(false);
  const [noticeClosed, setNoticeClosed] = useState(() => {
    try {
      return localStorage.getItem(NOTICE_KEY) || "";
    } catch {
      return "";
    }
  });
  const sentinel = useRef<HTMLDivElement | null>(null);
  const feedSeq = useRef(0);

  const site = useQuery({ queryKey: ["site-config"], queryFn: () => api.siteConfig(), staleTime: 5 * 60_000 });
  const guilds = useQuery({ queryKey: ["guilds"], queryFn: () => api.guilds(), staleTime: 5 * 60_000, enabled: guildOpen });

  const load = useCallback(
    async (nextPage: number, append = false) => {
      const seq = ++feedSeq.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setFailed(false);
      try {
        const res = await api.feed({
          space,
          guild_id: space === "guild" ? guildId || undefined : undefined,
          category: category || undefined,
          page: nextPage,
          page_size: 20,
        });
        if (seq !== feedSeq.current) return; // 切筛选后旧响应不得覆盖新列表
        const incoming = (res.items || []) as Post[];
        setItems((current) => (append ? [...current, ...incoming] : incoming));
        setPage(nextPage);
        setHasMore(Boolean(res.has_more));
      } catch (error) {
        if (seq !== feedSeq.current) return;
        setFailed(true);
        showToast(error instanceof Error ? error.message : "加载失败", "error");
      } finally {
        if (seq === feedSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [space, guildId, category, showToast],
  );

  /** 随机推荐：每次重新拉一批，独立于最新流的 items/page/hasMore */
  const loadRandom = useCallback(async () => {
    setRandomLoading(true);
    setRandomFailed(false);
    try {
      const res = await api.randomPosts();
      setRandomItems((res.posts || []) as Post[]);
      setRandomMode(true);
    } catch (error) {
      setRandomFailed(true);
      showToast(error instanceof Error ? error.message : "换一批失败", "error");
    } finally {
      setRandomLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(false);
    void load(1, false);
  }, [load]);

  // 切空间 / 会馆 / 分类就退出随机模式（随机流不参与筛选）
  useEffect(() => {
    setRandomMode(false);
  }, [space, guildId, category]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore && !failed && !randomMode) void load(page + 1, true);
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page, load, failed, randomMode]);

  /* ---------- 公告 ---------- */
  const announcement = site.data?.data?.announcement;
  const announcementText = typeof announcement === "string"
    ? announcement
    : announcement && announcement.enabled !== false
      ? announcement.text || announcement.title || ""
      : "";
  const announcementStamp = `${announcement?.version ?? ""}:${announcementText}`;
  const showNotice = Boolean(announcementText) && noticeClosed !== announcementStamp;

  const dismissNotice = () => {
    setNoticeClosed(announcementStamp);
    try {
      localStorage.setItem(NOTICE_KEY, announcementStamp);
    } catch {
      /* ignore */
    }
  };

  /* ---------- 刷新 / 筛选 ---------- */
  const refresh = useCallback(async () => {
    if (randomMode) {
      await loadRandom();
      return;
    }
    setItems([]);
    setPage(1);
    setHasMore(false);
    await load(1, false);
  }, [load, randomMode, loadRandom]);

  const selectSpace = (next: Space) => {
    if (next === "guild") {
      setGuildOpen(true);
      return;
    }
    setSpace(next);
    setCategory("");
    setGuildId(null);
    setGuildName("");
  };

  const selectGuild = (guild: any) => {
    setGuildId(Number(guild.id));
    setGuildName(String(guild.name || "会馆"));
    setSpace("guild");
    setCategory("");
    setGuildOpen(false);
  };

  const segItems: { key: Space; label: React.ReactNode }[] = [
    { key: "all", label: "全部" },
    { key: "public", label: "公共空间" },
    { key: "guild", label: space === "guild" && guildName ? <span className="feed-seg-name">{guildName}</span> : "会馆" },
  ];
  const chips = [{ key: "", label: "全部" }, ...Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label }))];

  return (
    <Screen
      className="feed-screen"
      appbar={
        <AppBar
          title={
            <span className="feed-brand">
              <img src="./assets/img/favicon.png" alt="妖精论坛" loading="lazy" decoding="async" />
              <span>妖精论坛</span>
            </span>
          }
          actions={
            <>
              <IconButton icon="search" label="搜索" onClick={() => push("search")} />
              <IconButton icon="home" label="会馆" onClick={() => push("guilds")} />
            </>
          }
        />
      }
      onRefresh={refresh}
    >
      {showNotice ? (
        <div className="feed-notice">
          <button className="feed-notice-main" onClick={() => push("changelog")} aria-label="查看公告">
            <Icon name="bell" size={14} />
            <span className="feed-notice-text">{announcementText}</span>
            <Icon name="forward" size={14} className="feed-notice-arrow" />
          </button>
          <button className="feed-notice-x" onClick={dismissNotice} aria-label="关闭公告">
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}

      <div className="feed-filters">
        <Segmented<Space> className="feed-seg" items={segItems} value={space} onChange={selectSpace} />
        <div className="feed-chips" role="tablist" aria-label="分类">
          {chips.map((chip) => (
            <button
              key={chip.key || "all"}
              role="tab"
              aria-selected={category === chip.key}
              className={`feed-chip ${category === chip.key ? "on" : ""}`.trim()}
              onClick={() => setCategory(chip.key)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="feed-reco">
        <span className="feed-reco-label">
          <Icon name="sparkle" size={13} />
          {randomMode ? "随机推荐" : "不知道看什么？"}
        </span>
        <button
          type="button"
          className="feed-reco-btn"
          disabled={randomLoading}
          aria-pressed={randomMode}
          onClick={() => void loadRandom()}
        >
          <Icon name="refresh" size={13} />
          {randomLoading ? "换一批中" : randomMode ? "换一批" : "推荐"}
        </button>
        {randomMode ? (
          <button type="button" className="feed-reco-back" onClick={() => setRandomMode(false)}>
            返回最新
          </button>
        ) : null}
      </div>

      {randomMode ? (
        randomLoading ? (
          <Skeletons count={3} />
        ) : randomFailed && randomItems.length === 0 ? (
          <div className="feed-failed">
            <span>随机推荐加载失败</span>
            <button className="m-btn m-btn--soft" onClick={() => void loadRandom()}>重试</button>
          </div>
        ) : randomItems.length === 0 ? (
          <Empty
            icon="sparkle"
            title="这批没有推荐"
            hint="换一批试试手气"
            action={<button className="m-btn m-btn--primary" onClick={() => void loadRandom()}>换一批</button>}
          />
        ) : (
          <div className="feed-list">
            {randomItems.map((post) => <FeedCard key={`reco-${post.id}`} post={post} />)}
          </div>
        )
      ) : loading && items.length === 0 ? (
        <Skeletons count={3} />
      ) : failed && items.length === 0 ? (
        <div className="feed-failed">
          <span>加载失败，请检查网络</span>
          <button className="m-btn m-btn--soft" onClick={() => void load(1, false)}>重试</button>
        </div>
      ) : items.length === 0 ? (
        <Empty
          icon="compass"
          title="还没有帖子"
          hint="成为第一个分享的人"
          action={<button className="m-btn m-btn--primary" onClick={() => push("compose")}>发帖</button>}
        />
      ) : (
        <div className="feed-list">
          {items.map((post) => <FeedCard key={post.id} post={post} />)}
        </div>
      )}

      {!randomMode ? (
        <>
          <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />
          {loadingMore ? <Loader text="加载更多…" /> : null}
          {failed && items.length > 0 ? (
            <div className="feed-failed">
              <span>加载更多失败</span>
              <button className="m-btn m-btn--soft" onClick={() => void load(page + 1, true)}>重试</button>
            </div>
          ) : null}
          {!hasMore && items.length > 0 && !loading ? <div className="m-end">— 到底了 —</div> : null}
        </>
      ) : null}

      <Sheet open={guildOpen} title="选择会馆" onClose={() => setGuildOpen(false)}>
        {guilds.isLoading ? (
          <Loader text="加载会馆…" />
        ) : guilds.isError ? (
          <div className="feed-failed">
            <span>会馆列表加载失败</span>
            <button className="m-btn m-btn--soft" onClick={() => void guilds.refetch()}>重试</button>
          </div>
        ) : (guilds.data?.guilds || []).length === 0 ? (
          <Empty icon="home" title="暂无会馆" hint="先去会馆页看看" />
        ) : (
          <div className="feed-guild-list">
            {(guilds.data?.guilds || []).map((guild: any) => {
              const tone = guild.theme_color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(guild.theme_color) ? guild.theme_color : "";
              const selected = guildId === Number(guild.id) && space === "guild";
              return (
                <button
                  key={guild.id}
                  className={`feed-guild-row ${selected ? "on" : ""}`.trim()}
                  onClick={() => selectGuild(guild)}
                  aria-pressed={selected}
                >
                  <span className="feed-guild-swatch" style={tone ? { background: tone, color: contrastText(tone) } : undefined}>
                    {String(guild.name || "会").slice(0, 1)}
                  </span>
                  <span className="feed-guild-info">
                    <span className="feed-guild-name">{guild.name}</span>
                    <span className="feed-guild-meta">{guild.member_count ?? 0} 位成员</span>
                  </span>
                  {selected ? <Icon name="check" size={18} className="feed-guild-check" /> : <Icon name="forward" size={16} className="feed-guild-chev" />}
                </button>
              );
            })}
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
