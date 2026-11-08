import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { AppBar, Avatar, Confirm, Empty, IconButton, Loader, Screen, Skeletons } from "../components/mobile";
import { Icon } from "../components/icons";
import { RichContent } from "../components/ui";
import { Lightbox } from "../components/Lightbox";
import { shareContent } from "../lib/native";
import { avatarUrl, formatDate, stripHtml, timeAgo } from "../lib/format";

/* 角色设定：移动端列表 + 详情（ch-*） */

/** 每人最多 20 个角色（服务端 characterMaxPerUser） */
const CHARACTER_LIMIT = 20;

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
  const showToast = useApp((s) => s.showToast);
  const viewer = useApp((s) => s.user);
  /** 有草稿时卡片优先展示草稿内容（未发布的修改也更像「他现在的样子」） */
  const draftData = item.draft && typeof item.draft === "object" ? item.draft : null;
  const name = String(draftData?.name || item.name || "");
  const identity = String(draftData?.identity || item.identity || "");
  const alias = String(draftData?.alias || item.alias || "");
  const avatar = draftData?.avatar_media_id
    ? sheetMediaPath(String(draftData.avatar_media_id))
    : sheetMediaPath(item.avatar);
  const guild = sheetGuildName(item);
  const summary = stripHtml(draftData?.description_html || item.description_html || item.intro || "");
  const status = Number(item.status);
  const draft = status === 0;
  /** 自己的设定不能点赞（服务端会拒）；mine 缺字段时用 user_id 兑底 */
  const mine = Boolean(item.mine) || Boolean(viewer?.id && String(viewer.id) === String(item.user_id));
  const updated = item.updated_at || item.created_at;
  const [liked, setLiked] = useState(Boolean(item.liked));
  const [likes, setLikes] = useState(Number(item.like_count) || 0);
  const [likeBusy, setLikeBusy] = useState(false);

  /** 乐观更新；失败回滚 */
  const toggleLike = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (likeBusy) return;
    const previous = { liked, likes };
    setLiked(!liked);
    setLikes(Math.max(0, likes + (liked ? -1 : 1)));
    setLikeBusy(true);
    try {
      const res = await api.likeCharacter(String(item.id));
      setLiked(Boolean(res?.liked));
      setLikes(Number(res?.likes) || 0);
    } catch (error) {
      setLiked(previous.liked);
      setLikes(previous.likes);
      showToast(error instanceof Error ? error.message : "点赞失败", "error");
    } finally {
      setLikeBusy(false);
    }
  };

  return (
    <div
      className={`ch-card${draft ? " is-draft" : ""}${status === 2 ? " is-off" : ""}`.trim()}
      role="button"
      tabIndex={0}
      aria-label={`${draft ? "编辑草稿" : "查看角色设定"} ${name || "未命名角色"}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="ch-card-head">
        <Avatar src={avatar} name={name} size={42} />
        <span className="ch-card-id">
          <span className="ch-name-row">
            <span className="ch-name">{name || "未命名角色"}</span>
            {draft ? <span className="ch-tag ch-tag--draft">草稿 · 点按编辑</span> : null}
            {status === 2 ? <span className="ch-tag ch-tag--off">已下架</span> : null}
            {item.has_draft && status !== 0 ? <span className="ch-tag ch-tag--draft">有未发布草稿</span> : null}
          </span>
          <span className="ch-tag-row">
            {identity ? <span className="ch-tag">{identity}</span> : null}
            {guild ? (
              <span className="ch-tag ch-tag--guild">
                <Icon name="home" size={11} />
                {guild}
              </span>
            ) : null}
            {alias ? <span className="ch-tag ch-tag--quiet">别称 · {alias}</span> : null}
          </span>
        </span>
        <Icon name={draft ? "edit" : "forward"} size={17} className="ch-card-chev" />
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
        {!mine ? (
          <button
            type="button"
            className={`ch-like-btn ${liked ? "on" : ""}`.trim()}
            aria-pressed={liked}
            aria-label={liked ? "取消点赞" : "点赞"}
            disabled={likeBusy}
            onClick={(event) => void toggleLike(event)}
          >
            <Icon name="heart" size={12} />
            {likes}
          </button>
        ) : likes > 0 ? (
          <span className="ch-like">
            <Icon name="heart" size={12} />
            {likes}
          </span>
        ) : null}
      </span>
    </div>
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

  /** 最多 20 个角色（服务端限制） */
  const limitReached = items.length >= CHARACTER_LIMIT;

  const openItem = (item: any) => {
    if (Number(item?.status) === 0) push("character-editor", { id: item.id });
    else push("character-detail", { id: item.id });
  };

  return (
    <Screen appbar={<AppBar back title="角色设定" />} onRefresh={async () => { await mine.refetch(); }}>
      {!user ? (
        <Empty
          icon="user"
          title="登录后查看角色设定"
          hint="登录后可以新建角色、自动保存草稿并发布，也能继续编辑未完成的设定。"
          action={
            <button type="button" className="m-btn m-btn--primary" onClick={() => push("auth")}>
              登录 / 注册
            </button>
          }
        />
      ) : (
        <>
          <div className="ch-top">
            <div className="ch-top-info">
              <span className="ch-top-title">我的角色</span>
              <span className="ch-top-count">{items.length} / {CHARACTER_LIMIT}</span>
            </div>
            <button
              type="button"
              className="m-btn m-btn--primary m-btn--sm ch-new"
              disabled={limitReached}
              aria-label="新建角色"
              onClick={() => push("character-editor")}
            >
              <Icon name="plus" size={15} />
              新建角色
            </button>
          </div>

          {mine.isLoading ? (
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
            <Empty
              icon="sparkle"
              title="还没有角色设定"
              hint="新建一个角色，写下名字、能力与描述；草稿每 3 秒自动保存。"
              action={
                <button type="button" className="m-btn m-btn--primary" onClick={() => push("character-editor")}>
                  新建角色
                </button>
              }
            />
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
                    <CharacterCard key={item.id} item={item} onOpen={() => openItem(item)} />
                  ))}
                </div>
              )}

              <div className="m-end">— 到底了 —</div>
            </>
          )}
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
  const { push, pop } = useNav();
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["character-sheet", sheetId],
    queryFn: () => api.characterSheet(sheetId),
    enabled: Boolean(sheetId),
  });

  const item = detail.data?.item;
  /** 本地点赞态：未操作时直接读详情数据（避免先闪一下 0 再补成真实数字） */
  const [likeState, setLikeState] = useState<{ liked: boolean; likes: number } | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
  /** mine 由服务端下发；旧接口缺字段时用 user_id 兑底 */
  const mine = item.mine === true || Boolean(user && String(user.id) === String(item.user_id));
  const liked = likeState ? likeState.liked : Boolean(item.liked);
  const likes = likeState ? likeState.likes : Number(item.like_count) || 0;

  const share = async () => {
    await shareContent({
      text: `角色设定：${item.name || "未命名角色"}`,
      url: `https://www.yjlt.top/character/${item.id ?? sheetId}`,
    }).catch(() => undefined);
  };

  /** 点赞：乐观更新，失败回滚 */
  const toggleLike = async () => {
    if (!user) {
      push("auth");
      return;
    }
    if (mine || likeBusy) return;
    const previous = { liked, likes };
    setLikeState({ liked: !liked, likes: Math.max(0, likes + (liked ? -1 : 1)) });
    setLikeBusy(true);
    try {
      const res = await api.likeCharacter(sheetId);
      setLikeState({ liked: Boolean(res?.liked), likes: Number(res?.likes) || 0 });
    } catch (error) {
      setLikeState(previous);
      showToast(error instanceof Error ? error.message : "点赞失败", "error");
    } finally {
      setLikeBusy(false);
    }
  };

  const removeCharacter = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await api.deleteCharacter(sheetId);
      void queryClient.invalidateQueries({ queryKey: ["character-sheets-mine"] });
      queryClient.removeQueries({ queryKey: ["character-sheet", sheetId] });
      showToast("角色已删除");
      pop();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除失败", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Screen
      appbar={
        <AppBar
          back
          title={item.name || "角色设定"}
          actions={
            <>
              <IconButton icon="share" label="分享角色设定" onClick={() => void share()} />
              {mine ? (
                <IconButton
                  icon="edit"
                  label="编辑角色设定"
                  onClick={() => push("character-editor", { id: sheetId })}
                />
              ) : null}
            </>
          }
        />
      }
      footer={
        <div className="m-actionbar ch-actionbar">
          {mine ? (
            <>
              <button
                type="button"
                className="m-btn m-btn--soft ch-edit-action"
                onClick={() => push("character-editor", { id: sheetId })}
              >
                <Icon name="edit" size={17} />
                {item.has_draft ? "继续编辑草稿" : "编辑设定"}
              </button>
              <button
                type="button"
                className="m-btn m-btn--danger ch-delete-action"
                disabled={deleting}
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" size={17} />
                {deleting ? "删除中…" : "删除"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`ch-like-action ${liked ? "on" : ""}`.trim()}
              aria-pressed={liked}
              aria-label={liked ? "取消点赞" : "点赞"}
              disabled={likeBusy}
              onClick={() => void toggleLike()}
            >
              <Icon name="heart" size={18} />
              {liked ? "已喜欢" : "喜欢"} · {likes}
            </button>
          )}
        </div>
      }
    >
      <div className="ch-detail">
        <header className="ch-hero">
          <Avatar src={sheetMediaPath(item.avatar)} name={item.name} size={88} />
          <h1 className="ch-hero-name">{item.name || "未命名角色"}</h1>
          {item.title ? <p className="ch-hero-title">{item.title}</p> : null}
          <div className="ch-tag-row ch-tag-row--center">
            <span className={`ch-tag ch-tag--status is-${status}`}>{statusLabel(status)}</span>
            {item.has_draft && status !== 0 ? <span className="ch-tag ch-tag--draft">有未发布草稿</span> : null}
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
                <button
                  key={`${src}-${index}`}
                  type="button"
                  className="ch-gallery-item"
                  aria-label={`查看第 ${index + 1} 张角色图片`}
                  onClick={() => setLightbox(index)}
                >
                  <img src={avatarUrl(src)} alt={`${item.name || "角色"} 图片 ${index + 1}`} loading="lazy" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {(item.user_id || item.published_at || item.updated_at || likes > 0) ? (
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
            {likes > 0 ? (
              <p className="ch-meta-line">
                <Icon name="heart" size={13} /> {likes} 人喜欢
              </p>
            ) : null}
          </section>
        ) : null}

        {mine ? (
          <p className="ch-note">草稿与修改仅自己可见，发布后才会公开展示；随时可以回来继续编辑。</p>
        ) : null}
      </div>

      {lightbox !== null ? (
        <Lightbox images={images} index={lightbox} onClose={() => setLightbox(null)} />
      ) : null}

      <Confirm
        open={confirmDelete}
        title="删除这个角色？"
        confirmText="删除"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void removeCharacter()}
      >
        角色设定与图片会被删除且无法恢复。
      </Confirm>
    </Screen>
  );
}
