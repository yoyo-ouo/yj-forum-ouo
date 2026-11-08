import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { Avatar, EmptyState, LoadMore, Loading, PostCard, RichContent, SpaceBadge, TopBar } from "../components/ui";
import { avatarUrl, contrastText, formatDate, stripHtml, timeAgo } from "../lib/format";
import type { Post } from "../lib/types";
// 仅本页需要的移动端适配（原生 button 复位 / 内边距收窄），不改 main.tsx 与共享样式
import "../styles/guilds-page.css";

/* ======================= 主题色 / 颜色可读性（口径对齐 Web lib/constants） ======================= */

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const MEDIA_ID_RE = /^MD[A-Za-z0-9]{8,62}$/;
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

function luminanceOf(hex?: string | null): number {
  const rgb = parseHex(hex);
  if (!rgb) return 1;
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function isLightHex(hex?: string | null, threshold = 0.35): boolean {
  return luminanceOf(hex) > threshold;
}

/** hero 前景色：亮色会馆用深字，暗色会馆用白字（Web guildForeground） */
function guildForeground(hex?: string | null): string {
  return isLightHex(hex) ? "#17323a" : "#ffffff";
}

/** 卡片底上的主题色文字：亮色主题色压暗，暗色主题色保持原色（Web themeInk） */
function themeInk(color?: string | null): string {
  const value = themeColor(color);
  const rgb = parseHex(value);
  if (!rgb || !isLightHex(value)) return value;
  const mix = (channel: number) => Math.round(channel * 0.45);
  return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
}

/** hero 依赖的 CSS 变量（--guild-fg / --guild-shade / --guild-ts，见 huiguan.css） */
function heroVars(hex: string): React.CSSProperties {
  const light = isLightHex(hex);
  return {
    "--guild-fg": guildForeground(hex),
    "--guild-fg-soft": light ? "rgba(23, 50, 58, 0.10)" : "rgba(255, 255, 255, 0.18)",
    "--guild-shade": light
      ? "linear-gradient(135deg, rgba(255, 255, 255, 0) 32%, rgba(255, 255, 255, 0.42) 100%)"
      : "linear-gradient(135deg, rgba(0, 0, 0, 0) 32%, rgba(0, 0, 0, 0.28) 100%)",
    "--guild-ts": light ? "none" : "0 1px 2px rgba(0, 0, 0, 0.28)",
  } as React.CSSProperties;
}

/** 媒体中台直出地址：仅 MD 开头的新媒体 ID 可读，旧 GridFS / 空值回退占位 */
function mediaIdUrl(id?: string | null): string {
  const value = (id || "").trim();
  return MEDIA_ID_RE.test(value) ? avatarUrl(`/ov2/api/media/${encodeURIComponent(value)}`) : "";
}

function formatDay(input?: string | null): string {
  if (!input) return "";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function guildKey(guild: any, index: number): string {
  return String(guild?.uuid || guild?.slug || guild?.id || index);
}

function itemKey(item: any): string {
  return `${item?.type || "post"}-${item?.id}`;
}

/* ======================= 会馆 Logo（对齐 Web components/ui/GuildLogo） ======================= */

function GuildLogo({
  logoFileId,
  name,
  hasLogo,
  color,
  size = 64,
  className = "guild-logo",
}: {
  logoFileId?: string | null;
  name?: string | null;
  hasLogo?: boolean;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const c = themeColor(color);
  const url = hasLogo ? mediaIdUrl(logoFileId) : "";
  if (url) {
    return (
      <div className={`${className} guild-logo-img`} style={{ width: size, height: size }}>
        <img src={url} alt={name || ""} />
      </div>
    );
  }
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${c} 0%, ${themeTint(c, "66")} 100%)`,
        fontSize: Math.round(size * 0.44),
      }}
    >
      {(name || "馆").slice(0, 1)}
    </div>
  );
}

/* ======================= 文章卡（对齐 Web components/ArticleCard） ======================= */

function ArticleCard({ item, showSpace = true }: { item: any; showSpace?: boolean }) {
  const { push } = useNav();
  const raw = stripHtml(item?.summary || "");
  const summary = raw.slice(0, 100);
  const authorName = item?.author?.name || item?.user_name || "佚名";
  const guildName = item?.guild_name || item?.user_guild_name || "";
  const guildTheme = item?.guild_theme_color || item?.user_guild_theme_color || "";

  return (
    <article
      className="post-card article-card"
      onClick={() => {
        if (item?.id !== undefined && item?.id !== null && item?.id !== "") push("article", { id: item.id });
      }}
    >
      <div className="post-card-left">
        <div className="post-card-avatar article-card-icon">
          <i className="fa fa-book" />
        </div>
      </div>
      <div className="post-card-body">
        <div className="post-card-header">
          <span className="article-badge">文章</span>
          {showSpace && guildName ? <SpaceBadge name={guildName} color={guildTheme} /> : null}
          <span className="post-card-author">{authorName}</span>
          <span className="post-card-time">{timeAgo(item?.updated_at || item?.created_at)}</span>
        </div>
        <h3 className="post-card-title">{item?.title || "未命名文章"}</h3>
        {summary ? <p className="post-card-summary">{summary}{raw.length >= 100 ? "..." : ""}</p> : null}
        <div className="post-card-footer">
          <span className="post-card-stats"><i className="fa fa-eye" /> {item?.views || 0}</span>
          <span className="post-card-stats article-card-author"><i className="fa fa-pencil" /> 执笔 {authorName}</span>
          {Number(item?.participants_count) > 0 ? (
            <span className="post-card-stats"><i className="fa fa-users" /> {item.participants_count}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/* ======================= 会馆广场：每个会馆一行（顶部栏 + 横向滚动内容区） ======================= */

function GuildFeedRow({ guild }: { guild: any }) {
  const { push } = useNav();
  const slug = String(guild?.slug || "");
  const name = guild?.name || "未命名会馆";
  const leader = guild?.leader;
  const theme = themeColor(guild?.theme_color);

  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(1);
  // 滚动事件高频触发，防止同一页被并发请求多次
  const loadingMoreRef = useRef(false);

  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const enter = () => {
    if (slug) push("guild", { slug });
  };

  const load = useCallback(
    async (page: number, append: boolean) => {
      if (!slug) return;
      if (append) {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setFailed(false);
      try {
        const res = await api.guildFeed(slug, page, 10);
        const incoming: any[] = (res?.items as any[]) || [];
        setItems((current) => {
          if (!append) return incoming;
          const seen = new Set(current.map(itemKey));
          return [...current, ...incoming.filter((item) => !seen.has(itemKey(item)))];
        });
        setHasMore(Boolean(res?.has_more));
        pageRef.current = page;
      } catch {
        setFailed(true);
        if (!append) {
          setItems([]);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [slug],
  );

  // 视口懒加载：会馆行进入可视区域（含 300px 预取边距）后才发起请求
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => void load(1, false), 0);
    return () => window.clearTimeout(timer);
  }, [visible, load]);

  const syncArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    syncArrows();
  }, [items, syncArrows]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    syncArrows();
    // 到达右边界附近自动续拉下一页（仅本行）
    if (hasMore && !loadingMoreRef.current && el.scrollLeft + el.clientWidth >= el.scrollWidth - 80) {
      void load(pageRef.current + 1, true);
    }
  };

  const scrollBy = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // 已在右边界（或内容不足一屏）时，点右箭头直接续拉下一页
    if (direction === 1 && hasMore && el.scrollLeft + el.clientWidth >= el.scrollWidth - 8) {
      void load(pageRef.current + 1, true);
      return;
    }
    el.scrollBy({ left: direction * Math.max(280, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="guild-row" ref={sectionRef}>
      <header className="guild-row-head">
        <div className="guild-row-identity">
          <GuildLogo
            logoFileId={guild?.logo_file_id}
            name={name}
            hasLogo={guild?.has_logo}
            color={guild?.theme_color}
            size={40}
            className="guild-logo guild-row-logo"
          />
          <div className="guild-row-names">
            <button type="button" className="guild-row-name" onClick={enter}>{name}</button>
            <span className="guild-row-leader">
              馆长：
              {leader?.id ? (
                <button type="button" className="guild-row-leader-link" onClick={() => push("user", { id: leader.id })}>
                  {leader.name}
                </button>
              ) : (
                "虚位以待"
              )}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="guild-row-enter"
          style={{ background: theme, color: contrastText(theme) }}
          onClick={enter}
        >
          进入会馆 <i className="fa fa-arrow-right" />
        </button>
      </header>

      <div className="guild-row-body">
        <button type="button" className="guild-row-arrow" aria-label="向左滚动" disabled={!canLeft} onClick={() => scrollBy(-1)}>
          <i className="fa fa-chevron-left" />
        </button>

        <div className="guild-row-scroller" ref={scrollerRef} onScroll={onScroll}>
          {!visible || loading ? (
            <div className="guild-row-loading"><i className="fa fa-spinner fa-spin" /> 加载中...</div>
          ) : failed && items.length === 0 ? (
            <div className="guild-row-error" role="alert">
              <i className="fa fa-exclamation-circle" /> 内容加载失败
              <button type="button" className="guild-row-retry" onClick={() => void load(1, false)}>重试</button>
            </div>
          ) : items.length === 0 ? (
            <div className="guild-row-empty">暂无内容</div>
          ) : (
            <>
              {items.map((item) => (
                <div className="guild-row-card" key={itemKey(item)}>
                  {item?.type === "article" ? (
                    <ArticleCard item={item} showSpace={false} />
                  ) : (
                    <PostCard post={{ ...item, title: String(item?.title || "") } as Post} />
                  )}
                </div>
              ))}
              {failed ? (
                <div className="guild-row-error is-tail" role="alert">
                  <button type="button" className="guild-row-retry" onClick={() => void load(pageRef.current + 1, true)}>
                    加载失败，点击重试
                  </button>
                </div>
              ) : null}
              {loadingMore ? (
                <div className="guild-row-loading is-tail"><i className="fa fa-spinner fa-spin" /></div>
              ) : null}
            </>
          )}
        </div>

        <button
          type="button"
          className="guild-row-arrow"
          aria-label="向右滚动"
          disabled={(!canRight && !hasMore) || !visible}
          onClick={() => scrollBy(1)}
        >
          <i className="fa fa-chevron-right" />
        </button>
      </div>
    </section>
  );
}

/* ======================= 会馆广场 ======================= */

export function GuildsScreen() {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const [view, setView] = useState<"rows" | "list">("rows");
  const guildsQuery = useQuery({ queryKey: ["guilds"], queryFn: () => api.guilds(), staleTime: 60_000 });

  useEffect(() => {
    if (guildsQuery.error) showToast(errorText(guildsQuery.error, "会馆列表加载失败"), "error");
  }, [guildsQuery.error, showToast]);

  const guilds: any[] = useMemo(() => {
    const list: any[] = guildsQuery.data?.guilds || [];
    return [...list].sort((a, b) => Number(a?.id ?? 0) - Number(b?.id ?? 0));
  }, [guildsQuery.data]);

  const enter = (guild: any) => {
    const slug = String(guild?.slug || "");
    if (slug) push("guild", { slug });
  };

  return (
    <div className="screen">
      <TopBar title="会馆" back />
      <div className="guild-page">
        <div className="guild-page-header">
          <h1 className="guild-page-title">会馆广场</h1>
          <p className="guild-page-subtitle">走进会馆，遇见同好</p>
          {guilds.length > 0 ? (
            <button className="guild-view-toggle" type="button" onClick={() => setView(view === "rows" ? "list" : "rows")}>
              <i className={`fa ${view === "rows" ? "fa-list-ul" : "fa-th-large"}`} />
              {view === "rows" ? "查看所有会馆" : "返回会馆广场"}
            </button>
          ) : null}
        </div>

        {guildsQuery.isLoading ? <Loading /> : null}

        {!guildsQuery.isLoading && guilds.length === 0 ? (
          <div className="guild-empty">
            <i className="fa fa-home" />
            <p className="guild-empty-title">{guildsQuery.isError ? "会馆列表加载失败" : "还没有会馆"}</p>
            <p className="guild-empty-desc">
              {guildsQuery.isError ? "请检查网络后重试，或稍后再来看看～" : "会馆正在筹建中，先去论坛逛逛吧～"}
            </p>
            {guildsQuery.isError ? (
              <button className="guild-empty-link" type="button" onClick={() => void guildsQuery.refetch()}>
                重新加载 <i className="fa fa-refresh" />
              </button>
            ) : (
              <button className="guild-empty-link" type="button" onClick={() => push("feed")}>
                前往论坛广场 <i className="fa fa-arrow-right" />
              </button>
            )}
          </div>
        ) : null}

        {guilds.length > 0 && view === "rows" ? (
          <div className="guild-rows">
            {guilds.map((guild, index) => (
              <GuildFeedRow key={guildKey(guild, index)} guild={guild} />
            ))}
          </div>
        ) : null}

        {guilds.length > 0 && view === "list" ? (
          <div className="guild-list">
            {guilds.map((guild, index) => {
              const theme = themeColor(guild?.theme_color);
              return (
                <button type="button" className="guild-list-item" key={guildKey(guild, index)} onClick={() => enter(guild)}>
                  <GuildLogo
                    logoFileId={guild?.logo_file_id}
                    name={guild?.name}
                    hasLogo={guild?.has_logo}
                    color={guild?.theme_color}
                    size={48}
                    className="guild-logo guild-list-logo"
                  />
                  <div className="guild-list-body">
                    <div className="guild-list-name-row">
                      <span className="guild-list-name">{guild?.name || "未命名会馆"}</span>
                      {guild?.id !== undefined && guild?.id !== null ? (
                        <span className="guild-list-id" style={{ background: theme, color: contrastText(theme) }}>
                          #{guild.id}
                        </span>
                      ) : null}
                    </div>
                    <p className="guild-list-intro">{guild?.intro || "这个会馆还没有简介～"}</p>
                  </div>
                  <div className="guild-list-meta">
                    <span><i className="fa fa-user-o" /> {guild?.leader?.name || "虚位以待"}</span>
                    <span className="guild-list-meta-link" title="查看成员名单">
                      <i className="fa fa-users" /> {guild?.member_count ?? 0}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ======================= 会馆详情：动态 Tab ======================= */

function GuildFeedTab({ slug }: { slug: string }) {
  const showToast = useApp((s) => s.showToast);
  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      if (!slug) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await api.guildFeed(slug, nextPage, 20);
        const incoming: any[] = (res?.items as any[]) || [];
        setItems((current) => {
          if (!append) return incoming;
          const seen = new Set(current.map(itemKey));
          return [...current, ...incoming.filter((item) => !seen.has(itemKey(item)))];
        });
        setPage(nextPage);
        setHasMore(Boolean(res?.has_more));
      } catch (error) {
        showToast(errorText(error, "动态加载失败"), "error");
        if (!append) {
          setItems([]);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [slug, showToast],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(1, false), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) return <Loading />;
  if (items.length === 0) return <EmptyState text="会馆里还没有内容" />;

  return (
    <>
      <div className="guild-feed-list">
        {items.map((item) =>
          item?.type === "article" ? (
            <ArticleCard key={itemKey(item)} item={item} />
          ) : (
            <PostCard key={itemKey(item)} post={{ ...item, title: String(item?.title || "") } as Post} />
          ),
        )}
      </div>
      <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void load(page + 1, true)} />
    </>
  );
}

/* ======================= 会馆详情：成员 Tab ======================= */

function GuildMembersTab({
  slug,
  leader,
  theme,
  ink,
  memberCount,
}: {
  slug: string;
  leader: any;
  theme: string;
  ink: string;
  memberCount?: number;
}) {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const [members, setMembers] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      if (!slug) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await api.guildMembers(slug, nextPage, 24);
        const incoming: any[] = res?.members || [];
        setMembers((current) => {
          if (!append) return incoming;
          const seen = new Set(current.map((member) => String(member?.kind || "member") + "-" + String(member?.id)));
          return [
            ...current,
            ...incoming.filter((member) => !seen.has(String(member?.kind || "member") + "-" + String(member?.id))),
          ];
        });
        setPage(nextPage);
        setHasMore(Boolean(res?.has_more));
      } catch (error) {
        showToast(errorText(error, "成员加载失败"), "error");
        if (!append) {
          setMembers([]);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [slug, showToast],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(1, false), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // 馆长已在特写卡单独展示，网格中跳过
  const gridMembers = members.filter((member) => !member?.is_leader);

  return (
    <>
      <div className="guild-members-header">
        <h1 className="guild-members-title">
          <i className="fa fa-users" /> 会馆成员{memberCount ? ` · 共 ${memberCount} 人` : ""}
        </h1>
      </div>

      {leader ? (
        <button
          type="button"
          className="guild-members-leader"
          style={{ borderColor: themeTint(theme, "55") }}
          onClick={() => {
            if (leader?.id) push("user", { id: leader.id });
          }}
        >
          <div className="guild-members-leader-avatar">
            <Avatar src={leader?.avatar} name={leader?.name} size={96} />
          </div>
          <div className="guild-members-leader-name-row">
            <span className="guild-members-leader-name">{leader?.name || "馆长"}</span>
            {leader?.title ? <span className="guild-leader-title" style={{ color: ink }}>{leader.title}</span> : null}
            <span className="guild-leader-tag" style={{ background: theme, color: contrastText(theme) }}>
              <i className="fa fa-crown" /> 馆长
            </span>
          </div>
          <p className="guild-members-leader-intro">{leader?.intro || "这位馆长很低调～"}</p>
        </button>
      ) : null}

      {loading ? (
        <Loading />
      ) : gridMembers.length === 0 ? (
        <EmptyState text="还没有成员" />
      ) : (
        <div className="guild-members-list">
          <div className="guild-members-grid">
            {gridMembers.map((member, index) => {
              const isCharacter = member?.kind === "character";
              const name = member?.character_name || member?.name || "会馆成员";
              const targetId = isCharacter ? member?.character_id : member?.id;
              return (
                <button
                  type="button"
                  className="guild-member-card"
                  key={`${member?.kind || "member"}-${member?.id || index}`}
                  title={isCharacter ? `${name} 的设定角色` : name}
                  onClick={() => {
                    if (targetId) push(isCharacter ? "character-detail" : "user", { id: targetId });
                  }}
                >
                  {isCharacter ? <span className="guild-member-char-badge">设定角色</span> : null}
                  <div className="guild-member-avatar">
                    <Avatar src={member?.avatar} name={name} size={56} />
                  </div>
                  <div className="guild-member-name">{name}</div>
                  <p className="guild-member-intro">
                    {isCharacter
                      ? member?.character_title || member?.intro || "这是一个设定角色"
                      : member?.intro || "这个人很懒，什么都没留下~"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!loading ? <LoadMore loading={loadingMore} hasMore={hasMore} onClick={() => void load(page + 1, true)} /> : null}
    </>
  );
}

/* ======================= 会馆详情：馆长 Tab ======================= */

function GuildLeaderTab({ slug, guild, theme, ink }: { slug: string; guild: any; theme: string; ink: string }) {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const leaderQuery = useQuery({
    queryKey: ["guild-leader", slug],
    queryFn: () => api.guildLeader(slug),
    enabled: Boolean(slug),
  });

  useEffect(() => {
    if (leaderQuery.error) showToast(errorText(leaderQuery.error, "馆长介绍加载失败"), "error");
  }, [leaderQuery.error, showToast]);

  if (leaderQuery.isLoading) return <Loading />;

  const data = leaderQuery.data;
  const leader = data?.leader;
  if (!leader) {
    return (
      <EmptyState
        text={leaderQuery.isError ? "馆长介绍加载失败" : "这个会馆还没有馆长"}
        action={
          leaderQuery.isError ? (
            <button className="btn ghost" onClick={() => void leaderQuery.refetch()}>重新加载</button>
          ) : undefined
        }
      />
    );
  }

  const content = data?.content || data?.content_html || "";
  const guildName = data?.guild?.name || guild?.name || "会馆";

  return (
    <>
      <div
        className="guild-leader-hero"
        style={{ background: `linear-gradient(135deg, ${theme} 0%, ${themeTint(theme, "cc")} 100%)`, ...heroVars(theme) }}
      >
        <div className="guild-hero-shade" />
        <div className="guild-leader-hero-body">
          <p className="guild-leader-hero-guild"><i className="fa fa-home" /> {guildName}</p>
          <div className="guild-leader-hero-avatar">
            <Avatar src={leader?.avatar} name={leader?.name} size={104} />
          </div>
          <div className="guild-leader-hero-name-row">
            <h1 className="guild-leader-hero-name">{leader?.name || "馆长"}</h1>
            {leader?.title ? <span className="guild-leader-hero-title">{leader.title}</span> : null}
            <span className="guild-leader-hero-tag"><i className="fa fa-crown" /> 馆长</span>
          </div>
          <p className="guild-leader-hero-intro">{leader?.intro || "这位馆长很低调～"}</p>
        </div>
      </div>

      <section className="guild-leader-panel">
        <h2 className="guild-leader-panel-title" style={{ color: ink }}><i className="fa fa-quote-left" /> 馆长寄语</h2>
        {data?.leader_bio ? (
          <blockquote className="guild-leader-quote">{data.leader_bio}</blockquote>
        ) : (
          <p className="guild-leader-placeholder">馆长还没有留下寄语～</p>
        )}
      </section>

      <section className="guild-leader-panel">
        <h2 className="guild-leader-panel-title" style={{ color: ink }}><i className="fa fa-star" /> 馆长介绍</h2>
        {content ? (
          <div className="guild-leader-content">
            <RichContent html={content} format="html" />
          </div>
        ) : (
          <p className="guild-leader-placeholder">馆长还没有填写介绍～</p>
        )}
      </section>

      {leader?.id ? (
        <div className="guild-leader-actions">
          <button
            type="button"
            className="guild-leader-profile-btn"
            style={{ background: theme, color: contrastText(theme) }}
            onClick={() => push("user", { id: leader.id })}
          >
            访问完整个人主页 <i className="fa fa-arrow-right" />
          </button>
        </div>
      ) : null}
    </>
  );
}

/* ======================= 会馆详情：介绍 Tab ======================= */

function GuildIntroTab({ slug, guild, theme, ink }: { slug: string; guild: any; theme: string; ink: string }) {
  const showToast = useApp((s) => s.showToast);
  const introQuery = useQuery({
    queryKey: ["guild-intro", slug],
    queryFn: () => api.guildIntro(slug),
    enabled: Boolean(slug),
  });

  useEffect(() => {
    if (introQuery.error) showToast(errorText(introQuery.error, "会馆介绍加载失败"), "error");
  }, [introQuery.error, showToast]);

  if (introQuery.isLoading) return <Loading />;

  const data = introQuery.data;
  const info = data?.guild || guild;
  if (!data && !introQuery.isError) return <EmptyState text="这个会馆还没有介绍" />;

  const content = data?.content || data?.content_html || "";
  const coverUrl = mediaIdUrl(info?.cover_file_id);
  const hasCover = Boolean(coverUrl);
  const lightTheme = isLightHex(theme);
  const vars = {
    "--guild-fg": hasCover ? "#ffffff" : guildForeground(theme),
    "--guild-fg-soft": hasCover
      ? "rgba(255, 255, 255, 0.18)"
      : lightTheme
        ? "rgba(23, 50, 58, 0.10)"
        : "rgba(255, 255, 255, 0.18)",
    "--guild-shade": hasCover
      ? "linear-gradient(180deg, rgba(8, 20, 26, 0.18) 0%, rgba(8, 20, 26, 0.62) 100%)"
      : lightTheme
        ? "linear-gradient(135deg, rgba(255, 255, 255, 0) 32%, rgba(255, 255, 255, 0.42) 100%)"
        : "linear-gradient(135deg, rgba(0, 0, 0, 0) 32%, rgba(0, 0, 0, 0.28) 100%)",
    "--guild-ts": hasCover || !lightTheme ? "0 1px 2px rgba(0, 0, 0, 0.28)" : "none",
  } as React.CSSProperties;
  const heroStyle: React.CSSProperties = hasCover
    ? { backgroundImage: `url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center", ...vars }
    : { background: `linear-gradient(135deg, ${theme} 0%, ${themeTint(theme, "cc")} 100%)`, ...vars };

  return (
    <>
      <div className="guild-intro-hero" style={heroStyle}>
        <div className="guild-hero-shade" />
        <div className="guild-intro-hero-body">
          <p className="guild-intro-hero-guild"><i className="fa fa-home" /> 会馆介绍</p>
          <span
            className="guild-intro-badge"
            style={{ background: hasCover ? "rgba(255, 255, 255, 0.18)" : "var(--guild-fg-soft)" }}
          >
            <i className="fa fa-building-o" />
          </span>
          <h1 className="guild-intro-hero-name">{info?.name || "会馆"}</h1>
          <p className="guild-intro-hero-intro">{info?.intro || "这个会馆还没有简介～"}</p>
        </div>
      </div>

      <div className="guild-intro-meta-card">
        <div className="guild-intro-meta-item">
          <i className="fa fa-clock-o" />
          <span className="guild-intro-meta-label">成立时间</span>
          <span className="guild-intro-meta-value">{info?.created_at ? formatDay(info.created_at) : "—"}</span>
        </div>
        <div className="guild-intro-meta-item">
          <i className="fa fa-users" />
          <span className="guild-intro-meta-label">成员</span>
          <span className="guild-intro-meta-value">{info?.member_count ?? 0} 人</span>
        </div>
        <div className="guild-intro-meta-item">
          <i className="fa fa-tags" />
          <span className="guild-intro-meta-label">分类</span>
          <span className="guild-intro-meta-value">
            {info?.category_count ?? (Array.isArray(guild?.categories) ? guild.categories.length : 0)} 个
          </span>
        </div>
      </div>

      <section className="guild-intro-panel">
        <h2 className="guild-intro-panel-title" style={{ color: ink }}><i className="fa fa-star" /> 会馆介绍</h2>
        {content ? (
          <div className="guild-intro-content">
            <RichContent html={content} format="html" />
          </div>
        ) : (
          <p className="guild-intro-placeholder">
            {introQuery.isError ? "会馆介绍暂时无法加载" : "这个会馆还没有填写介绍～"}
          </p>
        )}
      </section>
    </>
  );
}

/* ======================= 会馆详情 ======================= */

type GuildTab = "feed" | "members" | "leader" | "intro";

const GUILD_TABS: [GuildTab, string][] = [
  ["feed", "动态"],
  ["members", "成员"],
  ["leader", "馆长"],
  ["intro", "介绍"],
];

export function GuildDetailScreen({ slug }: { slug?: string }) {
  const guildSlug = String(slug || "");
  const showToast = useApp((s) => s.showToast);
  const [tab, setTab] = useState<GuildTab>("feed");
  const [bioOpen, setBioOpen] = useState(false);

  const guildQuery = useQuery({
    queryKey: ["guild", guildSlug],
    queryFn: () => api.guild(guildSlug),
    enabled: Boolean(guildSlug),
  });

  useEffect(() => {
    if (guildQuery.error) showToast(errorText(guildQuery.error, "会馆加载失败"), "error");
  }, [guildQuery.error, showToast]);

  const guild: any = guildQuery.data?.guild;
  const myState: any = guildQuery.data?.my_state;
  const guildName = guild?.name || "会馆";
  const theme = themeColor(guild?.theme_color);
  const ink = themeInk(theme);

  // 加入/退出只展示状态：不新增 API，点击时提示到网页版操作
  const joinHint = () => showToast("加入 / 退出会馆请在网页版操作", "info");

  if (!guildSlug) {
    return (
      <div className="screen">
        <TopBar title="会馆" back />
        <EmptyState text="会馆不存在或已被解散" />
      </div>
    );
  }

  if (guildQuery.isLoading) {
    return (
      <div className="screen">
        <TopBar title="会馆" back />
        <Loading />
      </div>
    );
  }

  if (!guild) {
    return (
      <div className="screen">
        <TopBar title="会馆" back />
        <EmptyState
          text={guildQuery.isError ? "会馆加载失败" : "会馆不存在或已被解散"}
          action={
            guildQuery.isError ? (
              <button className="btn ghost" onClick={() => void guildQuery.refetch()}>重新加载</button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const isMember = Boolean(myState?.is_member);
  const isLeader = Boolean(myState?.is_leader);
  const isPending = Boolean(myState?.has_pending_request);
  const latestRequest = myState?.latest_request || null;
  // 已通过的旧申请不再显示「查看申请进度」，允许重新申请
  const activeRequest = latestRequest && latestRequest.status !== 1 ? latestRequest : null;
  const currentOtherGuild = myState?.current_guild && myState.current_guild.id !== guild?.id ? myState.current_guild : null;
  const leader = guild?.leader;
  const leaderBio = guild?.leader_bio || leader?.bio || leader?.intro || "";

  return (
    <div className="screen">
      <TopBar title={guildName} back />
      <div
        className="guild-page guild-detail-page"
        style={{ background: `linear-gradient(180deg, ${themeTint(theme, "26")} 0%, transparent 340px)` }}
      >
        {/* 信息卡 */}
        <div className="guild-detail-hero" style={{ background: theme, ...heroVars(theme) }}>
          <div className="guild-hero-shade" />
          <GuildLogo
            logoFileId={guild?.logo_file_id}
            name={guildName}
            hasLogo={guild?.has_logo}
            color={guild?.theme_color}
            size={88}
            className="guild-logo guild-hero-logo"
          />
          <div className="guild-hero-body">
            <div className="guild-hero-name-row">
              <h1 className="guild-hero-name">{guildName}</h1>
              {guild?.id !== undefined && guild?.id !== null ? (
                <span className="guild-hero-id">#{guild.id}</span>
              ) : null}
            </div>
            <p className="guild-hero-intro">{guild?.intro || "这个会馆还没有简介～"}</p>
            <div className="guild-hero-meta">
              <button type="button" className="guild-hero-meta-link" onClick={() => setTab("members")}>
                <i className="fa fa-users" /> {guild?.member_count ?? 0} 人
              </button>
              <button type="button" className="guild-hero-meta-link" onClick={() => setTab("intro")}>
                <i className="fa fa-book" /> 会馆介绍
              </button>
              <span><i className="fa fa-clock-o" /> 创建于 {guild?.created_at ? formatDay(guild.created_at) : "—"}</span>
            </div>
          </div>

          {/* 加入区：已加入其他会馆时整块隐藏（与 Web 一致） */}
          {!currentOtherGuild ? (
            <div className="guild-join-area">
              {!myState ? (
                <button type="button" className="guild-join-btn" onClick={joinHint}>
                  <i className="fa fa-sign-in" /> 登录后加入
                </button>
              ) : isMember ? (
                <>
                  <span className="guild-joined-badge"><i className="fa fa-check" /> {isLeader ? "馆长" : "已加入"}</span>
                  {isLeader ? null : (
                    <button type="button" className="guild-leave-btn" onClick={joinHint}>退出会馆</button>
                  )}
                </>
              ) : isPending || activeRequest ? (
                <>
                  <button type="button" className="guild-join-btn pending" onClick={joinHint}>
                    <i className="fa fa-hourglass-half" /> 查看申请进度
                  </button>
                  <span className="guild-request-inline-status">
                    {isPending ? "审核中" : activeRequest?.status === 2 ? "未通过" : "已撤回"}
                  </span>
                </>
              ) : (
                <button type="button" className="guild-join-btn" onClick={joinHint}>
                  <i className="fa fa-plus" /> 申请加入
                </button>
              )}
            </div>
          ) : null}
        </div>

        {/* 馆长条 */}
        {leader ? (
          <div className={`guild-leader-bar${bioOpen ? " open" : ""}`}>
            <button type="button" className="guild-leader-main" onClick={() => setBioOpen(!bioOpen)}>
              <div className="guild-leader-avatar">
                <Avatar src={leader?.avatar} name={leader?.name} size={44} />
              </div>
              <div className="guild-leader-text">
                <div className="guild-leader-name">
                  {leader?.name || "馆长"}
                  {leader?.title ? <span className="guild-leader-title" style={{ color: ink }}>{leader.title}</span> : null}
                  <span className="guild-leader-tag" style={{ background: theme, color: contrastText(theme) }}>
                    <i className="fa fa-crown" /> 馆长
                  </span>
                </div>
                <p className="guild-leader-intro">{leader?.intro || "这位馆长很低调～"}</p>
              </div>
              <i className={`fa ${bioOpen ? "fa-chevron-up" : "fa-chevron-down"} guild-leader-toggle`} />
            </button>
            {bioOpen ? (
              <div className="guild-leader-zone">
                <div className="guild-leader-zone-title" style={{ color: ink }}>
                  <i className="fa fa-star" /> 馆长专区
                </div>
                <p className="guild-leader-bio">{leaderBio || "馆长还没有留下寄语～"}</p>
                <button type="button" className="guild-leader-link" style={{ color: ink }} onClick={() => setTab("leader")}>
                  查看馆长介绍页 <i className="fa fa-arrow-right" />
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="guild-leader-bar guild-leader-empty">
            <i className="fa fa-user-o" /> 馆长虚位以待
          </div>
        )}

        {/* 四个 Tab（Web 详情页分类行的样式） */}
        <div className="guild-feed-bar">
          <div className="guild-feed-cats">
            {GUILD_TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`guild-cat-chip${tab === key ? " active" : ""}`}
                style={tab === key ? { background: theme, color: contrastText(theme) } : undefined}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === "feed" ? <GuildFeedTab slug={guildSlug} /> : null}
        {tab === "members" ? (
          <GuildMembersTab slug={guildSlug} leader={leader} theme={theme} ink={ink} memberCount={guild?.member_count} />
        ) : null}
        {tab === "leader" ? <GuildLeaderTab slug={guildSlug} guild={guild} theme={theme} ink={ink} /> : null}
        {tab === "intro" ? <GuildIntroTab slug={guildSlug} guild={guild} theme={theme} ink={ink} /> : null}
      </div>
    </div>
  );
}

/* ======================= 会馆文章详情 ======================= */

export function ArticleScreen({ id }: { id?: string | number }) {
  const { push } = useNav();
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

  if (!articleId) {
    return (
      <div className="screen">
        <TopBar title="文章" back />
        <EmptyState text="文章不存在" />
      </div>
    );
  }

  if (articleQuery.isLoading) {
    return (
      <div className="screen">
        <TopBar title="文章" back />
        <Loading />
      </div>
    );
  }

  const article: any = articleQuery.data?.article;
  if (!article) {
    return (
      <div className="screen">
        <TopBar title="文章" back />
        <EmptyState
          text={articleQuery.isError ? "文章加载失败" : "文章不存在"}
          action={
            articleQuery.isError ? (
              <button className="btn ghost" onClick={() => void articleQuery.refetch()}>重新加载</button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const theme = themeColor(article?.guild_theme_color);
  const author = article?.author;
  const authorName = author?.name || article?.user_name || "佚名";
  const participants: any[] = Array.isArray(article?.participants) ? article.participants : [];
  const cover =
    article?.cover ||
    article?.cover_url ||
    article?.cover_image ||
    mediaIdUrl(article?.cover_file_id) ||
    mediaIdUrl(article?.guild_cover_file_id) ||
    "";
  const content = article?.content || article?.content_html || "";
  const contentFormat = article?.content_format || "html";
  const createdText = formatDate(article?.created_at);
  const updatedText = formatDate(article?.updated_at);

  return (
    <div className="screen">
      <TopBar title="文章" back />
      <div className="article-page">
        <div className="article-main">
          <h1 className="article-title">{article?.title || "未命名文章"}</h1>

          <div className="article-meta">
            {article?.guild_name ? (
              <button
                type="button"
                className="article-guild-tag"
                style={{ background: theme, color: contrastText(theme) }}
                onClick={() => {
                  if (article?.guild_slug) push("guild", { slug: article.guild_slug });
                }}
              >
                <i className="fa fa-home" /> {article.guild_name}
              </button>
            ) : null}

            {author?.id ? (
              <button
                type="button"
                className="article-meta-item article-meta-author"
                onClick={() => push("user", { id: author.id })}
              >
                <i className="fa fa-pencil" /> {authorName}
              </button>
            ) : (
              <span className="article-meta-item"><i className="fa fa-pencil" /> {authorName}</span>
            )}

            {participants.length > 0 ? (
              <span className="article-meta-participants">
                <i className="fa fa-users" /> 参与：
                {participants.map((participant: any, index: number) => (
                  <button
                    type="button"
                    className="article-participant"
                    key={`${participant?.user_id || index}`}
                    title={participant?.user_name || ""}
                    onClick={() => {
                      if (participant?.user_id) push("user", { id: participant.user_id });
                    }}
                  >
                    <Avatar src={participant?.avatar} name={participant?.user_name} size={22} />
                    <span className="article-participant-name">{participant?.user_name || "参与者"}</span>
                  </button>
                ))}
              </span>
            ) : null}

            {createdText ? (
              <span className="article-meta-item"><i className="fa fa-clock-o" /> 创建 {createdText}</span>
            ) : null}
            {updatedText ? (
              <span className="article-meta-item"><i className="fa fa-refresh" /> 更新 {updatedText}</span>
            ) : null}
            <span className="article-meta-item"><i className="fa fa-eye" /> {article?.views || 0}</span>
          </div>

          {cover ? <img className="article-cover" src={avatarUrl(cover)} alt="" /> : null}

          <div className="article-content">
            {content ? (
              <div className="post-body-html">
                <RichContent html={content} format={contentFormat} />
              </div>
            ) : (
              <p className="muted small">这篇文章还没有正文。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
