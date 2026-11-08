import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { EmptyState, Loading, PostCard } from "../components/ui";
import { CATEGORY_LABELS } from "../lib/format";
import type { Post } from "../lib/types";

type Space = "all" | "public" | "guild";

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
  const sentinel = useRef<HTMLDivElement | null>(null);

  const site = useQuery({ queryKey: ["site-config"], queryFn: () => api.siteConfig(), staleTime: 5 * 60_000 });
  const guilds = useQuery({ queryKey: ["guilds"], queryFn: () => api.guilds(), staleTime: 5 * 60_000 });

  const load = useCallback(
    async (nextPage: number, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await api.feed({
          space,
          guild_id: space === "guild" ? guildId || undefined : undefined,
          category: category || undefined,
          page: nextPage,
          page_size: 20,
        });
        const incoming = (res.items || []) as Post[];
        setItems((current) => (append ? [...current, ...incoming] : incoming));
        setPage(nextPage);
        setHasMore(Boolean(res.has_more));
      } catch (error) {
        showToast(error instanceof Error ? error.message : "加载失败", "error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [space, guildId, category, showToast],
  );

  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(false);
    void load(1, false);
  }, [load]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) void load(page + 1, true);
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page, load]);

  const announcement = site.data?.data?.announcement;
  const announcementText = typeof announcement === "string" ? announcement : announcement?.text || announcement?.title || "";
  const chips = [{ key: "", label: "全部" }, ...Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label }))];
  const selectSpace = (next: Space) => {
    setSpace(next);
    setCategory("");
    setGuildOpen(false);
    if (next !== "guild") { setGuildId(null); setGuildName(""); }
  };
  const selectGuild = (guild: any) => {
    setGuildId(Number(guild.id));
    setGuildName(guild.name);
    setSpace("guild");
    setCategory("");
    setGuildOpen(false);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div className="row" style={{ flex: 1, gap: 8 }}>
          <img src="./assets/img/favicon.png" alt="logo" className="header-logo-img" />
          <strong style={{ fontSize: 16 }}>妖精论坛</strong>
          <span className="header-brand-badge">ov2</span>
        </div>
        <button className="icon-btn" aria-label="搜索" onClick={() => push("search")}><i className="fa fa-search" /></button>
        <button className="icon-btn" aria-label="会馆" onClick={() => push("guilds")}><i className="fa fa-home" /></button>
      </header>

      <div className="forum-container">
        <div className="forum-header">
          <h1 className="forum-title">妖精论坛</h1>
          <p className="forum-subtitle">分享你的想法与故事</p>
          <button className="forum-create-btn" onClick={() => push("compose")}>
            <i className="fa fa-pencil" /> 发布帖子
          </button>
        </div>

        {announcementText ? (
          <div className="announcement-wrap">
            <div className="announcement-banner">
              <i className="fa fa-bullhorn announcement-icon" />
              <span className="announcement-text">{announcementText}</span>
              <button className="announcement-close" onClick={() => push("changelog")} aria-label="查看公告"><i className="fa fa-angle-right" /></button>
            </div>
          </div>
        ) : null}

        <div className="forum-filters">
          <div className="forum-filter-row">
            <span className="forum-filter-label">空间</span>
            <button className={`forum-tab ${space === "all" ? "active" : ""}`} onClick={() => selectSpace("all")}>全部</button>
            <button className={`forum-tab ${space === "public" ? "active" : ""}`} onClick={() => selectSpace("public")}>公共空间</button>
            <div className="forum-guild-select">
              <button className={`forum-tab forum-guild-toggle ${space === "guild" ? "active" : ""}`} onClick={() => setGuildOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={guildOpen}>
                <i className="fa fa-home" />
                <span className="forum-guild-toggle-text">{space === "guild" && guildName ? guildName : "会馆"}</span>
                <i className={`fa ${guildOpen ? "fa-caret-up" : "fa-caret-down"}`} />
              </button>
              {guildOpen ? (
                <div className="forum-guild-dropdown" role="listbox">
                  <div className="forum-guild-dropdown-title">选择会馆</div>
                  {(guilds.data?.guilds || []).length === 0 ? <div className="forum-guild-dropdown-empty">暂无会馆</div> : (
                    (guilds.data?.guilds || []).map((guild: any) => (
                      <button key={guild.id} className={`forum-guild-option ${guildId === Number(guild.id) ? "active" : ""}`} onClick={() => selectGuild(guild)}>
                        <span className="forum-guild-option-name">{guild.name}</span>
                        <span className="forum-guild-option-id">#{guild.id}</span>
                        <span className="forum-guild-option-count">{guild.member_count ?? 0} 人</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {space !== "all" ? (
            <div className="forum-filter-row forum-category-row">
              <span className="forum-filter-label">分类</span>
              {chips.map((chip) => (
                <button key={chip.key} className={`forum-tab ${category === chip.key ? "active" : ""}`} onClick={() => setCategory(chip.key)}>{chip.label}</button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="forum-post-list">
          {loading ? <Loading /> : items.length === 0 ? (
            <EmptyState text="暂无内容" action={<button className="forum-create-btn" onClick={() => push("compose")}><i className="fa fa-pencil" /> 发布第一帖</button>} />
          ) : items.map((post) => <PostCard key={post.id} post={post} />)}
        </div>
        <div ref={sentinel} />
        {loadingMore ? <Loading text="加载更多…" /> : null}
        {hasMore ? (
          <div className="forum-load-more">
            <button onClick={() => void load(page + 1, true)} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更多"}</button>
          </div>
        ) : items.length > 0 ? <div className="list-end">— 到底了 —</div> : null}
      </div>
    </div>
  );
}
