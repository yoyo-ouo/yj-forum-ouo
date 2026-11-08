import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { requestApi, shareContent } from "../lib/native";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import {
  AppBar,
  Avatar,
  Cell,
  Confirm,
  Empty,
  IconButton,
  Screen,
  Segmented,
  Sheet,
  Skeletons,
} from "../components/mobile";
import { RichContent } from "../components/ui";
import { Icon } from "../components/icons";
import { avatarUrl, contrastText, formatDate, timeAgo } from "../lib/format";

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

/** 封面文字：亮色会馆用深字，暗色会馆用白字（对齐 Web guildForeground） */
function guildForeground(hex?: string | null): string {
  return isLightHex(hex) ? "#17323a" : "#ffffff";
}

/** 卡片底上的主题色文字：亮色主题色压暗，暗色主题色保持原色（对齐 Web themeInk） */
function themeInk(color?: string | null): string {
  const value = themeColor(color);
  const rgb = parseHex(value);
  if (!rgb || !isLightHex(value)) return value;
  const mix = (channel: number) => Math.round(channel * 0.45);
  return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
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

/** 会馆首字：名称前 1-2 个字符（emoji / 生僻字按码点切） */
function guildInitials(name?: string | null): string {
  const chars = Array.from(String(name || "馆").trim());
  return chars.slice(0, 2).join("") || "馆";
}

/** 加入 / 退出 / 撤回：沿用服务端会馆接口（api.ts 未封装，这里走原生 requestApi） */
async function postGuildAction(path: string): Promise<any> {
  const res = await requestApi<any>({
    method: "POST",
    path,
    body: path.endsWith("/join") ? { reason: "" } : undefined,
  });
  const data: any = res.data;
  if (!res.ok || data?.success === false) {
    throw new Error(data?.message || data?.error || "操作失败");
  }
  return data;
}

/* ======================= 会馆 Logo / 徽标 ======================= */

function GuildLogo({ guild, size = 44 }: { guild: any; size?: number }) {
  const name = guild?.name || "会馆";
  const color = themeColor(guild?.theme_color);
  const url = guild?.has_logo ? mediaIdUrl(guild?.logo_file_id) : "";
  const initials = guildInitials(name);
  return (
    <span
      className="gd-logo"
      style={{
        width: size,
        height: size,
        background: url ? undefined : `linear-gradient(135deg, ${color} 0%, ${themeTint(color, "cc")} 100%)`,
        color: contrastText(color),
        fontSize: Math.round(size * (initials.length > 1 ? 0.32 : 0.4)),
      }}
    >
      {url ? <img src={url} alt={name} loading="lazy" /> : initials}
    </span>
  );
}

/* ======================= 会馆列表卡片 ======================= */

function GuildCard({ guild, onClick }: { guild: any; onClick: () => void }) {
  const leaderName = guild?.leader?.name ? String(guild.leader.name) : "";
  return (
    <button type="button" className="gd-card" onClick={onClick}>
      <GuildLogo guild={guild} size={44} />
      <span className="gd-card-main">
        <span className="gd-card-name">{guild?.name || "未命名会馆"}</span>
        <span className="gd-card-meta">
          {leaderName ? `馆长 ${leaderName}` : "馆长虚位以待"} · {guild?.member_count ?? 0} 位成员
        </span>
        <span className="gd-card-intro">{guild?.intro || "这个会馆还没有简介～"}</span>
      </span>
      <Icon name="forward" size={18} className="gd-chev" />
    </button>
  );
}

/* ======================= 会馆列表 ======================= */

export function GuildsScreen() {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
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
    <Screen
      appbar={<AppBar back title="会馆" />}
      onRefresh={async () => {
        await guildsQuery.refetch();
      }}
    >
      <div className="gd-head">
        <span className="gd-head-text">走进会馆，遇见同好</span>
      </div>

      {guildsQuery.isLoading ? <Skeletons count={5} /> : null}

      {!guildsQuery.isLoading && guilds.length === 0 ? (
        <Empty
          icon="home"
          title={guildsQuery.isError ? "会馆列表加载失败" : "还没有会馆"}
          hint={guildsQuery.isError ? "请检查网络后重试，或稍后再来看看～" : "会馆正在筹建中，先去广场逛逛吧～"}
          action={
            <button
              type="button"
              className="m-btn m-btn--soft"
              onClick={() => {
                if (guildsQuery.isError) void guildsQuery.refetch();
                else push("feed");
              }}
            >
              {guildsQuery.isError ? "重新加载" : "去广场逛逛"}
            </button>
          }
        />
      ) : null}

      {guilds.length > 0 ? (
        <div className="gd-list">
          {guilds.map((guild, index) => (
            <GuildCard key={guildKey(guild, index)} guild={guild} onClick={() => enter(guild)} />
          ))}
        </div>
      ) : null}
    </Screen>
  );
}

/* ======================= 会馆动态行（帖子 / 文章统一紧凑行） ======================= */

function GuildFeedItem({ item, onOpen }: { item: any; onOpen: () => void }) {
  const isArticle = item?.type === "article";
  const title = item?.title || (isArticle ? "未命名文章" : "无标题帖子");
  const author = item?.author?.name || item?.user_name || item?.author_name || "佚名";
  const when = timeAgo(item?.updated_at || item?.published_at || item?.created_at);
  const views = Number(item?.views || 0);
  const likes = Number(item?.likes || 0);
  const comments = Number(item?.comment_count || 0);

  return (
    <button type="button" className="gd-item" onClick={onOpen}>
      <span className="gd-item-main">
        <span className="gd-item-title">{title}</span>
        <span className="gd-item-meta">
          {isArticle ? <span className="m-pill gd-item-kind">文章</span> : null}
          <span>{author}</span>
          {when ? (
            <>
              <span>·</span>
              <span>{when}</span>
            </>
          ) : null}
          <span>·</span>
          <span>{views} 阅读</span>
          {!isArticle && likes > 0 ? (
            <>
              <span>·</span>
              <span>{likes} 赞</span>
            </>
          ) : null}
          {!isArticle && comments > 0 ? (
            <>
              <span>·</span>
              <span>{comments} 评</span>
            </>
          ) : null}
        </span>
      </span>
      <Icon name="forward" size={16} className="gd-chev" />
    </button>
  );
}

/* ======================= 会馆详情：动态 ======================= */

function GuildFeedTab({ slug }: { slug: string }) {
  const { push } = useNav();
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

  if (loading) return <Skeletons count={3} />;
  if (items.length === 0) return <Empty icon="sparkle" title="会馆里还没有动态" hint="成为第一个在这里发帖的人吧" />;

  return (
    <div className="gd-panel">
      <div className="gd-items">
        {items.map((item) => (
          <GuildFeedItem
            key={itemKey(item)}
            item={item}
            onOpen={() => {
              if (item?.id === undefined || item?.id === null || item?.id === "") return;
              push(item?.type === "article" ? "article" : "post", { id: item.id });
            }}
          />
        ))}
      </div>
      {hasMore ? (
        <button type="button" className="m-more" disabled={loadingMore} onClick={() => void load(page + 1, true)}>
          {loadingMore ? "加载中…" : "加载更多"}
        </button>
      ) : (
        <div className="m-end">— 到底了 —</div>
      )}
    </div>
  );
}

/* ======================= 会馆详情：成员 ======================= */

function GuildMembersTab({
  slug,
  theme,
  ink,
  memberCount,
}: {
  slug: string;
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

  if (loading) return <Skeletons count={2} />;
  if (members.length === 0) return <Empty icon="user" title="还没有成员" hint="邀请同好一起加入这个会馆吧" />;

  return (
    <div className="gd-panel">
      <p className="gd-count">共 {memberCount ?? members.length} 位成员</p>
      <div className="gd-grid">
        {members.map((member, index) => {
          const isCharacter = member?.kind === "character";
          const isMemberLeader = Boolean(member?.is_leader) || member?.role === "leader";
          const name = member?.character_name || member?.name || "会馆成员";
          const targetId = isCharacter ? member?.character_id : member?.id;
          return (
            <button
              type="button"
              className="gd-member"
              key={`${member?.kind || "member"}-${member?.id || index}-${index}`}
              title={isCharacter ? `${name} 的设定角色` : name}
              onClick={() => {
                if (targetId) push(isCharacter ? "character-detail" : "user", { id: targetId });
              }}
            >
              <Avatar src={member?.avatar} name={name} size={48} />
              <span className="gd-member-name">{name}</span>
              {isMemberLeader ? (
                <span className="gd-member-tag" style={{ background: themeTint(theme, "2e"), color: ink }}>
                  馆长
                </span>
              ) : isCharacter ? (
                <span className="gd-member-tag gd-member-tag--char">角色</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {hasMore ? (
        <button type="button" className="m-more" disabled={loadingMore} onClick={() => void load(page + 1, true)}>
          {loadingMore ? "加载中…" : "加载更多"}
        </button>
      ) : (
        <div className="m-end">— 到底了 —</div>
      )}
    </div>
  );
}

/* ======================= 会馆详情：介绍（会馆介绍 + 馆长信息） ======================= */

function GuildInfoTab({ slug, guild, theme }: { slug: string; guild: any; theme: string }) {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const introQuery = useQuery({
    queryKey: ["guild-intro", slug],
    queryFn: () => api.guildIntro(slug),
    enabled: Boolean(slug),
  });
  const leaderQuery = useQuery({
    queryKey: ["guild-leader", slug],
    queryFn: () => api.guildLeader(slug),
    enabled: Boolean(slug),
  });

  useEffect(() => {
    if (introQuery.error) showToast(errorText(introQuery.error, "会馆介绍加载失败"), "error");
  }, [introQuery.error, showToast]);

  useEffect(() => {
    if (leaderQuery.error) showToast(errorText(leaderQuery.error, "馆长介绍加载失败"), "error");
  }, [leaderQuery.error, showToast]);

  if (introQuery.isLoading) return <Skeletons count={2} />;

  const info = introQuery.data?.guild || guild;
  const content = introQuery.data?.content || introQuery.data?.content_html || "";
  const leaderData = leaderQuery.data;
  const leader = leaderData?.leader;
  const leaderBio = leaderData?.leader_bio || guild?.leader_bio || "";
  const leaderContent = leaderData?.content || leaderData?.content_html || "";
  const categoryCount = info?.category_count ?? (Array.isArray(guild?.categories) ? guild.categories.length : 0);

  return (
    <div className="gd-panel">
      <div className="gd-meta">
        <div className="gd-meta-item">
          <span className="gd-meta-k">成立时间</span>
          <span className="gd-meta-v">{info?.created_at ? formatDay(info.created_at) : "—"}</span>
        </div>
        <div className="gd-meta-item">
          <span className="gd-meta-k">成员</span>
          <span className="gd-meta-v">{info?.member_count ?? guild?.member_count ?? 0}</span>
        </div>
        <div className="gd-meta-item">
          <span className="gd-meta-k">分类</span>
          <span className="gd-meta-v">{categoryCount}</span>
        </div>
      </div>

      <section className="gd-card-block">
        <h2 className="gd-sec-title">会馆介绍</h2>
        {content ? (
          <div className="gd-rich">
            <RichContent html={content} format="html" />
          </div>
        ) : (
          <p className="gd-placeholder">
            {introQuery.isError ? "会馆介绍暂时无法加载" : "这个会馆还没有填写介绍～"}
          </p>
        )}
      </section>

      {leaderQuery.isLoading ? <Skeletons count={1} /> : null}

      {leader ? (
        <section className="gd-card-block">
          <h2 className="gd-sec-title">馆长 · {leader?.name || "虚位以待"}</h2>
          <div className="gd-leader-row">
            <Avatar src={leader?.avatar} name={leader?.name} size={44} />
            <div className="gd-leader-info">
              <span className="gd-leader-name">{leader?.name || "馆长"}</span>
              <span className="gd-leader-intro">{leader?.intro || "这位馆长很低调～"}</span>
            </div>
          </div>
          {leaderBio ? <blockquote className="gd-quote">{leaderBio}</blockquote> : null}
          {leaderContent ? (
            <div className="gd-rich gd-rich--leader">
              <RichContent html={leaderContent} format="html" />
            </div>
          ) : null}
          {leader?.id ? (
            <button
              type="button"
              className="gd-link"
              style={{ color: themeInk(theme) }}
              onClick={() => push("user", { id: leader.id })}
            >
              访问馆长主页 <Icon name="forward" size={13} />
            </button>
          ) : null}
        </section>
      ) : null}

      {!leaderQuery.isLoading && !leader ? <p className="gd-placeholder">这个会馆还没有馆长</p> : null}
    </div>
  );
}

/* ======================= 会馆详情 ======================= */

type GuildTab = "feed" | "members" | "intro";

const GUILD_TABS: { key: GuildTab; label: string }[] = [
  { key: "feed", label: "动态" },
  { key: "members", label: "成员" },
  { key: "intro", label: "介绍" },
];

function coverStyle(theme: string): React.CSSProperties {
  return {
    background: `linear-gradient(135deg, ${theme} 0%, ${themeTint(theme, "b3")} 52%, ${themeTint(theme, "00")} 100%)`,
    "--gd-fg": guildForeground(theme),
    "--gd-ts": isLightHex(theme) ? "none" : "0 1px 3px rgba(0, 0, 0, 0.28)",
  } as React.CSSProperties;
}

export function GuildDetailScreen({ slug }: { slug?: string }) {
  const { push } = useNav();
  const me = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const guildSlug = String(slug || "");
  const [tab, setTab] = useState<GuildTab>("feed");
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const leader = guild?.leader;
  const isMember = Boolean(myState?.is_member);
  const isLeader = Boolean(myState?.is_leader);
  const isPending = Boolean(myState?.has_pending_request);
  const latestRequest = myState?.latest_request || null;
  const rejected = latestRequest?.status === 2 || latestRequest?.status === 3;
  const otherGuild = myState?.current_guild && myState.current_guild.id !== guild?.id ? myState.current_guild : null;

  const act = async (kind: "join" | "leave" | "cancel") => {
    const path = `/guilds/${encodeURIComponent(guildSlug)}/${kind === "join" ? "join" : kind === "leave" ? "leave" : "join/cancel"}`;
    setBusy(true);
    try {
      const data = await postGuildAction(path);
      showToast(data?.message || (kind === "join" ? "申请已提交" : kind === "leave" ? "已退出会馆" : "申请已撤回"));
      setLeaveOpen(false);
      setPendingOpen(false);
      await guildQuery.refetch();
    } catch (error) {
      showToast(errorText(error, "操作失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const shareGuild = async () => {
    try {
      await shareContent({
        text: `${guildName} · 妖精论坛会馆`,
        url: `https://www.yjlt.top/huiguan/${encodeURIComponent(guildSlug)}`,
      });
    } catch {
      showToast("分享未完成", "info");
    }
  };

  if (!guildSlug) {
    return (
      <Screen appbar={<AppBar back title="会馆" />}>
        <Empty icon="home" title="会馆不存在或已被解散" />
      </Screen>
    );
  }

  if (guildQuery.isLoading) {
    return (
      <Screen appbar={<AppBar back title="会馆" />}>
        <Skeletons count={3} />
      </Screen>
    );
  }

  if (!guild) {
    return (
      <Screen appbar={<AppBar back title="会馆" />}>
        <Empty
          icon="home"
          title={guildQuery.isError ? "会馆加载失败" : "会馆不存在或已被解散"}
          action={
            guildQuery.isError ? (
              <button type="button" className="m-btn m-btn--soft" onClick={() => void guildQuery.refetch()}>
                重新加载
              </button>
            ) : undefined
          }
        />
      </Screen>
    );
  }

  const joinLabel = !me
    ? "登录后加入"
    : isMember
      ? isLeader
        ? "我是馆长"
        : "退出会馆"
      : isPending
        ? "申请审核中"
        : rejected
          ? "重新申请"
          : "申请加入";
  const joinPrimary = !me || (!isMember && !isPending);
  const joinDisabled = busy || isPending || isLeader || Boolean(otherGuild);

  const onJoinClick = () => {
    if (!me) {
      showToast("请先登录后再申请加入", "info");
      push("auth");
      return;
    }
    if (otherGuild) {
      showToast(`你已加入「${otherGuild.name}」，请先退出`, "info");
      return;
    }
    if (isMember) {
      if (isLeader) {
        showToast("馆长需先卸任才能退出会馆", "info");
        return;
      }
      setLeaveOpen(true);
      return;
    }
    if (isPending) {
      setPendingOpen(true);
      return;
    }
    void act("join");
  };

  return (
    <Screen
      appbar={<AppBar back title={guildName} actions={<IconButton icon="more" label="更多" onClick={() => setMoreOpen(true)} />} />}
    >
      <div className="gd-cover" style={coverStyle(theme)}>
        <div className="gd-cover-body">
          <h1 className="gd-cover-name">{guildName}</h1>
          <p className="gd-cover-meta">
            馆长 {leader?.name || "虚位以待"} · {guild?.member_count ?? 0} 位成员
          </p>
        </div>
      </div>

      <p className="gd-brief">{guild?.intro || "这个会馆还没有简介～"}</p>

      <div className="gd-join">
        {isLeader ? (
          <div className="gd-leader">
            <Icon name="shield" size={17} />
            <span>你是本会馆的馆长</span>
          </div>
        ) : (
          <button
            type="button"
            className={`m-btn m-btn--block ${joinPrimary ? "m-btn--primary" : "m-btn--soft"} ${isMember && !isLeader ? "m-btn--danger" : ""}`.trim()}
            disabled={joinDisabled}
            onClick={onJoinClick}
          >
            {busy ? "处理中…" : joinLabel}
          </button>
        )}
        {isPending ? (
          <button type="button" className="gd-link gd-link--center" onClick={() => setPendingOpen(true)}>
            申请审核中，查看详情与撤回
          </button>
        ) : null}
        {otherGuild ? <p className="gd-join-note">你已加入「{otherGuild.name}」，退出后才能加入本会馆</p> : null}
        {isMember && !isLeader ? <p className="gd-join-note">你是本会馆成员</p> : null}
      </div>

      <div className="gd-seg">
        <Segmented<GuildTab> items={GUILD_TABS} value={tab} onChange={setTab} />
      </div>

      {tab === "feed" ? <GuildFeedTab slug={guildSlug} /> : null}
      {tab === "members" ? (
        <GuildMembersTab slug={guildSlug} theme={theme} ink={ink} memberCount={guild?.member_count} />
      ) : null}
      {tab === "intro" ? <GuildInfoTab slug={guildSlug} guild={guild} theme={theme} /> : null}

      <Sheet open={moreOpen} title="会馆操作" onClose={() => setMoreOpen(false)}>
        <div className="m-list gd-sheet-list">
          <Cell icon="share" label="分享会馆" chevron={false} onClick={() => { setMoreOpen(false); void shareGuild(); }} />
          <Cell
            icon="user"
            label={`查看成员（${guild?.member_count ?? 0}）`}
            onClick={() => { setTab("members"); setMoreOpen(false); }}
          />
          <Cell icon="info" label="会馆介绍" onClick={() => { setTab("intro"); setMoreOpen(false); }} />
          <Cell icon="refresh" label="刷新" chevron={false} onClick={() => { setMoreOpen(false); void guildQuery.refetch(); }} />
        </div>
      </Sheet>

      <Sheet
        open={pendingOpen}
        title="入馆申请"
        onClose={() => setPendingOpen(false)}
        footer={
          <button type="button" className="m-btn m-btn--ghost" disabled={busy} onClick={() => void act("cancel")}>
            撤回申请
          </button>
        }
      >
        <p className="gd-sheet-text">申请已提交，等待馆长审核。</p>
        {latestRequest?.reason ? <p className="gd-sheet-sub">申请理由：{latestRequest.reason}</p> : null}
        {latestRequest?.created_at ? <p className="gd-sheet-sub">提交时间：{formatDate(latestRequest.created_at)}</p> : null}
      </Sheet>

      <Confirm
        open={leaveOpen}
        title="退出会馆"
        confirmText="退出"
        onConfirm={() => void act("leave")}
        onCancel={() => setLeaveOpen(false)}
      >
        退出后将失去会馆成员身份，确定要退出「{guildName}」吗？
      </Confirm>
    </Screen>
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
      <Screen appbar={<AppBar back title="文章" />}>
        <Empty icon="info" title="文章不存在" />
      </Screen>
    );
  }

  if (articleQuery.isLoading) {
    return (
      <Screen appbar={<AppBar back title="文章" />}>
        <Skeletons count={3} />
      </Screen>
    );
  }

  const article: any = articleQuery.data?.article;
  if (!article) {
    return (
      <Screen appbar={<AppBar back title="文章" />}>
        <Empty
          icon="info"
          title={articleQuery.isError ? "文章加载失败" : "文章不存在"}
          action={
            articleQuery.isError ? (
              <button type="button" className="m-btn m-btn--soft" onClick={() => void articleQuery.refetch()}>
                重新加载
              </button>
            ) : undefined
          }
        />
      </Screen>
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

  const shareArticle = async () => {
    try {
      await shareContent({
        text: article?.title || "妖精论坛文章",
        url: `https://www.yjlt.top/article/${encodeURIComponent(articleId)}`,
      });
    } catch {
      showToast("分享未完成", "info");
    }
  };

  return (
    <Screen
      appbar={<AppBar back title="文章" actions={<IconButton icon="share" label="分享" onClick={() => void shareArticle()} />} />}
    >
      <article className="gd-ar">
        <h1 className="gd-ar-title">{article?.title || "未命名文章"}</h1>

        <div className="gd-ar-author">
          <Avatar src={author?.avatar || article?.user_avatar} name={authorName} size={28} />
          {author?.id ? (
            <button type="button" className="gd-ar-author-name" onClick={() => push("user", { id: author.id })}>
              {authorName}
            </button>
          ) : (
            <span className="gd-ar-author-name">{authorName}</span>
          )}
          {article?.guild_name ? (
            <button
              type="button"
              className="gd-ar-guild"
              style={{ background: themeTint(theme, "24"), color: themeInk(theme) }}
              onClick={() => {
                if (article?.guild_slug) push("guild", { slug: article.guild_slug });
              }}
            >
              {article.guild_name}
            </button>
          ) : null}
        </div>

        <div className="gd-ar-meta">
          {createdText ? <span>创建 {createdText}</span> : null}
          {updatedText ? <span>更新 {updatedText}</span> : null}
          {participants.length > 0 ? <span>{participants.length} 人参与</span> : null}
        </div>

        {cover ? <img className="gd-ar-cover" src={avatarUrl(cover)} alt="" loading="lazy" /> : null}

        <div className="gd-ar-body">
          {content ? (
            <RichContent html={content} format={contentFormat} />
          ) : (
            <p className="gd-placeholder">这篇文章还没有正文。</p>
          )}
        </div>

        {participants.length > 0 ? (
          <div className="gd-ar-people">
            <span className="gd-sec-title">参与者</span>
            <div className="gd-ar-people-row">
              {participants.map((participant: any, index: number) => (
                <button
                  type="button"
                  className="gd-ar-person"
                  key={`${participant?.user_id || index}`}
                  title={participant?.user_name || ""}
                  onClick={() => {
                    if (participant?.user_id) push("user", { id: participant.user_id });
                  }}
                >
                  <Avatar src={participant?.avatar} name={participant?.user_name} size={22} />
                  <span>{participant?.user_name || "参与者"}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="gd-ar-stats">
          <span>
            <Icon name="eye" size={13} /> {article?.views || 0} 阅读
          </span>
          {Number(article?.likes) > 0 ? (
            <span>
              <Icon name="like" size={13} /> {article.likes}
            </span>
          ) : null}
          {Number(article?.comment_count) > 0 ? (
            <span>
              <Icon name="comment" size={13} /> {article.comment_count}
            </span>
          ) : null}
        </div>
      </article>
    </Screen>
  );
}
