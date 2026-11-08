import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { AppBar, Avatar, Empty, IconButton, Loader, Screen, Skeletons } from "../components/mobile";
import { Icon } from "../components/icons";
import { RichContent } from "../components/ui";
import { shareContent } from "../lib/native";
import { avatarUrl, formatDate, stripHtml, timeAgo } from "../lib/format";

/* 角色设定：移动端列表 + 详情（ch-*） */

/** 性别：0 无 / 1 男 / 2 女（与后端一致） */
function genderLabel(value: unknown): string {
  if (Number(value) === 1) return "男";
  if (Number(value) === 2) return "女";
  return "无";
}

/** 能力胶囊文案：有具体能力时用「系 · 具体」 */
function abilityText(ability: any): string {
  const category = String(ability?.category || "").trim();
  const detail = String(ability?.detail || "").trim();
  if (!category) return detail || "未知";
  return detail ? `${category} · ${detail}` : category;
}

/**
 * 角色媒体地址：后端 avatar 已是 /ov2/api/media/<id>，
 * images 则是裸 media_id，要补成 /ov2/api/media/<id> 再交给 mediaUrl。
 */
function sheetMediaPath(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("/") || path.startsWith("http") || path.startsWith("data:") || path.startsWith("blob:")) {
    return path;
  }
  return `/ov2/api/media/${path}`;
}

/** 会馆名：绑定会馆时用会馆名，自定义时用自定义名 */
function sheetGuildName(sheet: any): string {
  return sheet?.guild_id ? String(sheet?.guild_name || "") : String(sheet?.guild_custom_name || "");
}

/** 公开状态：1 已公开 / 0 草稿 / 2 管理员下架 */
function statusLabel(status: unknown): string {
  if (Number(status) === 0) return "草稿";
  if (Number(status) === 2) return "已下架";
  return "已公开";
}

/* ---------------- 列表卡片 ---------------- */

function CharacterCard({ item, onOpen }: { item: any; onOpen: () => void }) {
  const guild = sheetGuildName(item);
  const summary = stripHtml(item.description_html || item.intro || "");
  const status = Number(item.status);
  const updated = item.updated_at || item.created_at;
  return (
    <button
      type="button"
      className={`ch-card${status === 0 ? " is-draft" : ""}${status === 2 ? " is-off" : ""}`.trim()}
      aria-label={`查看角色设定 ${item.name || "未命名角色"}`}
      onClick={onOpen}
    >
      <span className="ch-card-head">
        <Avatar src={sheetMediaPath(item.avatar)} name={item.name} size={42} />
        <span className="ch-card-id">
          <span className="ch-name-row">
            <span className="ch-name">{item.name || "未命名角色"}</span>
            {status === 0 ? <span className="ch-tag ch-tag--draft">草稿</span> : null}
            {status === 2 ? <span className="ch-tag ch-tag--off">已下架</span> : null}
          </span>
          <span className="ch-tag-row">
            {item.identity ? <span className="ch-tag">{item.identity}</span> : null}
            {guild ? (
              <span className="ch-tag ch-tag--guild">
                <Icon name="home" size={11} />
                {guild}
              </span>
            ) : null}
            {item.alias ? <span className="ch-tag ch-tag--quiet">别称 · {item.alias}</span> : null}
          </span>
        </span>
        <Icon name="forward" size={17} className="ch-card-chev" />
      </span>
      {summary ? <span className="ch-summary m-clamp2">{summary}</span> : null}
      <span className="ch-card-foot">
        {updated ? (
          <span className="ch-time">
            <Icon name="clock" size={12} />
            更新于 {timeAgo(updated)}
          </span>
        ) : (
          <span className="ch-time" />
        )}
        {Number(item.like_count) > 0 ? (
          <span className="ch-like">
            <Icon name="heart" size={12} />
            {item.like_count}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/* ---------------- 列表页 ---------------- */

export function CharacterScreen() {
  const user = useApp((s) => s.user);
  const { push } = useNav();
  const [filter, setFilter] = useState("all");
  const mine = useQuery({
    queryKey: ["character-sheets-mine", user?.id],
    queryFn: () => api.characterSheetsMine(),
    enabled: Boolean(user?.id),
  });

  const items: any[] = Array.isArray(mine.data?.items) ? mine.data.items : [];

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: items.length, "1": 0, "0": 0, "2": 0 };
    items.forEach((item) => {
      const key = String(Number(item?.status ?? 1));
      if (key in result) result[key] += 1;
    });
    return result;
  }, [items]);

  /** 只有出现多种状态时才需要筛选胶囊 */
  const statuses = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => set.add(String(Number(item?.status ?? 1))));
    return set;
  }, [items]);

  const filters = useMemo(
    () => [
      { key: "all", label: "全部", count: items.length },
      ...(["1", "0", "2"] as const)
        .filter((key) => statuses.has(key))
        .map((key) => ({ key: key as string, label: statusLabel(key), count: counts[key] })),
    ],
    [counts, items.length, statuses],
  );

  const shown = filter === "all" ? items : items.filter((item) => String(Number(item?.status ?? 1)) === filter);

  return (
    <Screen appbar={<AppBar back title="角色设定" />} onRefresh={async () => { await mine.refetch(); }}>
      {!user ? (
        <Empty
          icon="user"
          title="登录后查看角色设定"
          hint="角色设定卡在网页端创建与编辑，APP 内可随时查看。"
          action={
            <button type="button" className="m-btn m-btn--primary" onClick={() => push("auth")}>
              登录 / 注册
            </button>
          }
        />
      ) : mine.isLoading ? (
        <Skeletons count={3} />
      ) : mine.error ? (
        <Empty
          icon="info"
          title="角色设定加载失败"
          hint={mine.error instanceof Error ? mine.error.message : "请稍后再试"}
          action={
            <button type="button" className="m-btn" onClick={() => void mine.refetch()}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <Empty icon="sparkle" title="还没有角色设定" hint="角色设定卡在网页端创建与编辑，APP 内可随时查看。" />
      ) : (
        <>
          {statuses.size > 1 ? (
            <div className="m-chips ch-filters">
              {filters.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={`m-chip ${filter === entry.key ? "on" : ""}`.trim()}
                  onClick={() => setFilter(entry.key)}
                >
                  {entry.label}
                  <span className="ch-chip-count">{entry.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          {shown.length === 0 ? (
            <Empty icon="search" title="没有符合条件的角色" hint="换一个筛选看看" />
          ) : (
            <div className="ch-list">
              {shown.map((item: any) => (
                <CharacterCard key={item.id} item={item} onOpen={() => push("character-detail", { id: item.id })} />
              ))}
            </div>
          )}

          <div className="m-end">— 到底了 —</div>
        </>
      )}
    </Screen>
  );
}

/* ---------------- 详情页 ---------------- */

function FieldRow({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`ch-field${wide ? " ch-field--wide" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function CharacterDetailScreen({ id }: { id?: string | number }) {
  const sheetId = id === undefined || id === null ? "" : String(id);
  const { push } = useNav();
  const detail = useQuery({
    queryKey: ["character-sheet", sheetId],
    queryFn: () => api.characterSheet(sheetId),
    enabled: Boolean(sheetId),
  });

  const item = detail.data?.item;

  if (!sheetId) {
    return (
      <Screen appbar={<AppBar back title="角色设定" />}>
        <Empty icon="info" title="缺少角色参数" hint="无法打开这份角色设定。" />
      </Screen>
    );
  }

  if (detail.isLoading) {
    return (
      <Screen appbar={<AppBar back title="角色设定" />}>
        <Loader text="加载角色设定" />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen appbar={<AppBar back title="角色设定" />}>
        <Empty
          icon="info"
          title="角色设定不可见"
          hint={detail.error instanceof Error ? detail.error.message : "这份设定不存在或未公开。"}
          action={
            <button type="button" className="m-btn" onClick={() => void detail.refetch()}>
              重试
            </button>
          }
        />
      </Screen>
    );
  }

  const abilities: any[] = Array.isArray(item.abilities) ? item.abilities : [];
  const images: string[] = (Array.isArray(item.images) ? item.images : [])
    .map((image: any) => sheetMediaPath(typeof image === "string" ? image : image?.url || ""))
    .filter(Boolean);
  const quotes: any[] = (Array.isArray(item.quotes) ? item.quotes : []).filter((quote: any) =>
    String(quote?.content || "").trim(),
  );
  const guild = sheetGuildName(item);
  const status = Number(item.status);
  const description = item.description_html || item.content || "";
  const ownerName = item.owner_name || "";

  const share = async () => {
    await shareContent({
      text: `角色设定：${item.name || "未命名角色"}`,
      url: `https://www.yjlt.top/character/${item.id ?? sheetId}`,
    }).catch(() => undefined);
  };

  return (
    <Screen
      appbar={
        <AppBar
          back
          title={item.name || "角色设定"}
          actions={<IconButton icon="share" label="分享角色设定" onClick={() => void share()} />}
        />
      }
    >
      <div className="ch-detail">
        <header className="ch-hero">
          <Avatar src={sheetMediaPath(item.avatar)} name={item.name} size={88} />
          <h1 className="ch-hero-name">{item.name || "未命名角色"}</h1>
          {item.title ? <p className="ch-hero-title">{item.title}</p> : null}
          <div className="ch-tag-row ch-tag-row--center">
            <span className={`ch-tag ch-tag--status is-${status}`}>{statusLabel(status)}</span>
            {item.identity ? <span className="ch-tag">{item.identity}</span> : null}
            {guild ? (
              <span className="ch-tag ch-tag--guild">
                <Icon name="home" size={11} />
                {guild}
              </span>
            ) : null}
            {item.alias ? <span className="ch-tag ch-tag--quiet">别称 · {item.alias}</span> : null}
          </div>
        </header>

        <section className="ch-section">
          <h2 className="ch-section-title">基本资料</h2>
          <dl className="ch-fields">
            <FieldRow label="性别" value={genderLabel(item.gender)} />
            <FieldRow label="年龄" value={item.age || "—"} />
            <FieldRow label="体态" value={item.build || "—"} />
            <FieldRow label="物种" value={item.species || "—"} />
            {item.identity ? <FieldRow label="身份" value={item.identity} wide /> : null}
          </dl>
        </section>

        {abilities.length > 0 ? (
          <section className="ch-section">
            <h2 className="ch-section-title">能力</h2>
            <div className="ch-abilities">
              {abilities.map((ability, index) => (
                <span className="ch-ability" key={`${ability?.category || "ability"}-${index}`}>
                  {abilityText(ability)}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {quotes.length > 0 ? (
          <section className="ch-section">
            <h2 className="ch-section-title">语录</h2>
            <div className="ch-quotes">
              {quotes.map((quote: any, index: number) => (
                <blockquote className="ch-quote" key={quote?.id ?? index}>
                  {quote.content}
                </blockquote>
              ))}
            </div>
          </section>
        ) : null}

        {description ? (
          <section className="ch-section">
            <h2 className="ch-section-title">角色描述</h2>
            <div className="m-rich">
              <RichContent html={description} format="html" />
            </div>
          </section>
        ) : null}

        {images.length > 0 ? (
          <section className="ch-section">
            <h2 className="ch-section-title">图集</h2>
            <div className="ch-gallery">
              {images.map((src: string, index: number) => (
                <img
                  key={`${src}-${index}`}
                  src={avatarUrl(src)}
                  alt={`${item.name || "角色"} 图片 ${index + 1}`}
                  loading="lazy"
                />
              ))}
            </div>
          </section>
        ) : null}

        {(item.user_id || item.published_at || item.updated_at || Number(item.like_count) > 0) ? (
          <section className="ch-section ch-meta">
            {item.user_id ? (
              <button type="button" className="ch-owner" onClick={() => push("user", { id: item.user_id })}>
                <Avatar src={item.owner_avatar} name={ownerName} size={28} />
                <span className="ch-owner-name">{ownerName ? `${ownerName} 的主页` : "设定者主页"}</span>
                <Icon name="forward" size={16} className="ch-card-chev" />
              </button>
            ) : null}
            {item.published_at ? <p className="ch-meta-line">发布于 {formatDate(item.published_at)}</p> : null}
            {item.updated_at ? <p className="ch-meta-line">最后更新 {formatDate(item.updated_at)}</p> : null}
            {Number(item.like_count) > 0 ? (
              <p className="ch-meta-line">
                <Icon name="heart" size={13} /> {item.like_count} 人喜欢
              </p>
            ) : null}
          </section>
        ) : null}

        <p className="ch-note">角色编辑请在网页端完成</p>
      </div>
    </Screen>
  );
}
