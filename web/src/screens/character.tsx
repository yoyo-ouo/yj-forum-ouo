import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { Loading, RichContent, TopBar } from "../components/ui";
import { avatarUrl, formatDate, timeAgo } from "../lib/format";
import "../styles/character-settings-page.css";

/** 六大能力系（与 Web character-constants 一致）：决定 .cs-ab-1 ~ .cs-ab-6 的配色 */
const CHARACTER_CATEGORIES = ["御灵系", "生灵系", "锁御系", "造物系", "心灵系", "空间系"];

function categoryIndex(name?: string | null): number {
  const index = CHARACTER_CATEGORIES.indexOf(String(name || ""));
  return index >= 0 ? index + 1 : 0;
}

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
function sheetMediaUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("/") || path.startsWith("http") || path.startsWith("data:") || path.startsWith("blob:")) {
    return avatarUrl(path);
  }
  return avatarUrl(`/ov2/api/media/${path}`);
}

/** 会馆名：绑定会馆时用会馆名，自定义时用自定义名 */
function sheetGuildName(sheet: any): string {
  return sheet?.guild_id ? String(sheet?.guild_name || "") : String(sheet?.guild_custom_name || "");
}

function initialOf(name?: string | null): string {
  return Array.from(String(name || "?").trim())[0] || "?";
}

/** 公开状态：1 已公开 / 0 草稿 / 2 管理员下架 */
function StatusChip({ status }: { status?: number | null }) {
  if (Number(status) === 1) return <span className="cs-status cs-status-1">已公开</span>;
  if (Number(status) === 2) return <span className="cs-status cs-status-2">已下架</span>;
  return <span className="cs-badge-draft">草稿</span>;
}

/** 四格属性：性别 / 年龄 / 体态 / 物种（与 Web 卡片一致） */
function SheetAttrs({ sheet }: { sheet: any }) {
  return (
    <dl className="cs-attrs">
      <div className="cs-attr"><dt>性别</dt><dd>{genderLabel(sheet?.gender)}</dd></div>
      <div className="cs-attr"><dt>年龄</dt><dd>{sheet?.age || "—"}</dd></div>
      <div className="cs-attr"><dt>体态</dt><dd>{sheet?.build || "—"}</dd></div>
      <div className="cs-attr"><dt>物种</dt><dd>{sheet?.species || "—"}</dd></div>
    </dl>
  );
}

/** 能力胶囊行（无能力时占位，让会馆与点赞靠右） */
function AbilityTags({ abilities }: { abilities: any[] }) {
  if (abilities.length === 0) return <span className="cs-bottom-spacer" />;
  return (
    <div className="cs-abilities">
      {abilities.map((ability, index) => (
        <span
          key={`${ability?.category || "ability"}-${index}`}
          className={`cs-ab cs-ab-${categoryIndex(ability?.category)}`}
        >
          {abilityText(ability)}
        </span>
      ))}
    </div>
  );
}

export function CharacterScreen() {
  const user = useApp((s) => s.user);
  const { push } = useNav();
  const mine = useQuery({
    queryKey: ["character-sheets-mine", user?.id],
    queryFn: () => api.characterSheetsMine(),
    enabled: Boolean(user?.id),
  });

  if (!user) {
    return (
      <div className="screen">
        <TopBar title="角色设定" back />
        <div className="cs-page">
          <div className="cs-page-empty">
            <i className="fa fa-book" aria-hidden="true"></i>
            <p>登录后查看你的角色设定</p>
            <button type="button" className="cs-btn cs-btn-primary" onClick={() => push("auth")}>登录 / 注册</button>
          </div>
        </div>
      </div>
    );
  }

  const items: any[] = Array.isArray(mine.data?.items) ? mine.data.items : [];
  const errorText = mine.error instanceof Error ? mine.error.message : "加载失败";

  return (
    <div className="screen">
      <TopBar title="角色设定" back />
      <div className="cs-page">
        <div className="cs-section-head">
          <h3><i className="fa fa-book" aria-hidden="true"></i> 我的角色设定</h3>
          <span className="cs-section-count">{mine.isLoading ? "加载中…" : `${items.length} 个`}</span>
        </div>

        {mine.isLoading ? (
          <Loading />
        ) : mine.error ? (
          <div className="cs-section-empty">
            <p>{errorText}</p>
            <button type="button" className="cs-btn cs-btn-ghost" onClick={() => void mine.refetch()}>重试</button>
          </div>
        ) : items.length === 0 ? (
          <div className="cs-section-empty">
            <p>还没有角色设定。角色设定卡在网页端创建与编辑，APP 内可以随时查看。</p>
          </div>
        ) : (
          <div className="cs-page-list">
            {items.map((item: any) => (
              <article
                key={item.id}
                className={`cs-card${Number(item.status) === 0 ? " is-draft" : ""}${Number(item.status) === 2 ? " is-hidden" : ""}`}
                style={{ cursor: "pointer" }}
                role="button"
                tabIndex={0}
                aria-label={`查看角色设定 ${item.name || "未命名角色"}`}
                onClick={() => push("character-detail", { id: item.id })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    push("character-detail", { id: item.id });
                  }
                }}
              >
                <div className="cs-head">
                  <div className="cs-avatar">
                    {item.avatar ? (
                      <img src={sheetMediaUrl(item.avatar)} alt={item.name || "角色头像"} loading="lazy" />
                    ) : (
                      <span>{initialOf(item.name)}</span>
                    )}
                  </div>
                  <div className="cs-id">
                    <div className="cs-name-row">
                      <h3 className="cs-name">{item.name || "未命名角色"}</h3>
                      {item.title ? <span className="cs-title">{item.title}</span> : null}
                      <StatusChip status={item.status} />
                    </div>
                    <div className="cs-sub">
                      {item.alias ? <span className="cs-alias">别称 · {item.alias}</span> : null}
                      <span className="cs-owner">
                        <i className="fa fa-clock-o" aria-hidden="true"></i> 更新于 {timeAgo(item.updated_at || item.created_at) || "刚刚"}
                      </span>
                    </div>
                  </div>
                  <div className="cs-head-actions">
                    <span className="cs-more-btn">查看 <i className="fa fa-angle-right" aria-hidden="true"></i></span>
                  </div>
                </div>

                <SheetAttrs sheet={item} />

                {item.identity ? (
                  <div className="cs-idline">
                    <em>身份</em>
                    <span>{item.identity}</span>
                  </div>
                ) : null}

                <div className="cs-bottom">
                  <AbilityTags abilities={Array.isArray(item.abilities) ? item.abilities : []} />
                  <div className="cs-end">
                    {sheetGuildName(item) ? (
                      <span className="cs-guild" title={sheetGuildName(item)}>
                        <i className="fa fa-home" aria-hidden="true"></i> {sheetGuildName(item)}
                      </span>
                    ) : null}
                    <span className="cs-like cs-like-static">
                      <i className="fa fa-heart-o" aria-hidden="true"></i>
                      <b>{item.like_count || 0}</b>
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="cs-section-hint">角色设定卡在网页端创建与编辑，APP 内可随时查看。</p>
      </div>
    </div>
  );
}

export function CharacterDetailScreen({ id }: { id?: string | number }) {
  const sheetId = id === undefined || id === null ? "" : String(id);
  const detail = useQuery({
    queryKey: ["character-sheet", sheetId],
    queryFn: () => api.characterSheet(sheetId),
    enabled: Boolean(sheetId),
  });

  const { push } = useNav();

  if (!sheetId) {
    return (
      <div className="screen">
        <TopBar title="角色设定" back />
        <div className="cs-page">
          <div className="cs-page-empty">
            <i className="fa fa-chain-broken" aria-hidden="true"></i>
            <p>缺少角色参数，无法打开设定</p>
          </div>
        </div>
      </div>
    );
  }

  if (detail.isLoading) {
    return <div className="screen"><TopBar title="角色设定" back /><Loading /></div>;
  }

  const item = detail.data?.item;
  if (!item) {
    return (
      <div className="screen">
        <TopBar title="角色设定" back />
        <div className="cs-page">
          <div className="cs-page-empty">
            <i className="fa fa-chain-broken" aria-hidden="true"></i>
            <p>{detail.error instanceof Error ? detail.error.message : "角色设定不存在或未公开"}</p>
            <button type="button" className="cs-btn cs-btn-ghost" onClick={() => void detail.refetch()}>重试</button>
          </div>
        </div>
      </div>
    );
  }

  const abilities: any[] = Array.isArray(item.abilities) ? item.abilities : [];
  const images = (Array.isArray(item.images) ? item.images : [])
    .map((image: any) => sheetMediaUrl(typeof image === "string" ? image : image?.url || ""))
    .filter(Boolean);
  const quotes = (Array.isArray(item.quotes) ? item.quotes : []).filter((quote: any) =>
    String(quote?.content || "").trim(),
  );
  const guild = sheetGuildName(item);
  const description = item.description_html || "";
  const ownerName = item.owner_name || "";
  const hasMore = Boolean(description) || images.length > 0 || quotes.length > 0;

  return (
    <div className="screen">
      <TopBar title={item.name || "角色设定"} back />
      <div className="cs-page">
        <div className="cs-page-inner">
          <article className={`cs-card${Number(item.status) === 0 ? " is-draft" : ""}${Number(item.status) === 2 ? " is-hidden" : ""}`}>
            <div className="cs-head">
              <div className="cs-avatar">
                {item.avatar ? (
                  <img src={sheetMediaUrl(item.avatar)} alt={item.name || "角色头像"} />
                ) : (
                  <span>{initialOf(item.name)}</span>
                )}
              </div>
              <div className="cs-id">
                <div className="cs-name-row">
                  <h3 className="cs-name">{item.name || "未命名角色"}</h3>
                  {item.title ? <span className="cs-title">{item.title}</span> : null}
                  <StatusChip status={item.status} />
                </div>
                {item.alias || ownerName ? (
                  <div className="cs-sub">
                    {item.alias ? <span className="cs-alias">别称 · {item.alias}</span> : null}
                    {ownerName ? (
                      <span className="cs-owner">
                        <i className="fa fa-user-o" aria-hidden="true"></i> {ownerName} 的设定
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <SheetAttrs sheet={item} />

            {item.identity ? (
              <div className="cs-idline">
                <em>身份</em>
                <span>{item.identity}</span>
              </div>
            ) : null}

            <div className="cs-bottom">
              <AbilityTags abilities={abilities} />
              <div className="cs-end">
                {guild ? (
                  <span className="cs-guild" title={guild}>
                    <i className="fa fa-home" aria-hidden="true"></i> {guild}
                  </span>
                ) : null}
                <span className="cs-like cs-like-static">
                  <i className="fa fa-heart-o" aria-hidden="true"></i>
                  <b>{item.like_count || 0}</b>
                </span>
              </div>
            </div>

            {hasMore ? (
              <div className="cs-more">
                {quotes.length > 0 ? (
                  <div className="cs-lead-quote">
                    <span className="cs-lead-qm" aria-hidden="true">“</span>
                    {quotes.map((quote: any, index: number) => (
                      <p key={quote?.id ?? index} className="cs-lead-line">{quote.content}</p>
                    ))}
                  </div>
                ) : null}

                {description ? (
                  <section className="cs-block">
                    <h4 className="cs-block-title">角色描述</h4>
                    <RichContent html={description} format="html" />
                  </section>
                ) : null}

                {images.length > 0 ? (
                  <section className="cs-block">
                    <h4 className="cs-block-title">
                      图集<span className="cs-block-count">{images.length}</span>
                    </h4>
                    <div className={`cs-strip cs-strip-${Math.min(images.length, 3)}`}>
                      {images.map((src: string, index: number) => (
                        <img key={`${src}-${index}`} src={src} alt={`${item.name || "角色"} 图片 ${index + 1}`} loading="lazy" />
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </article>

          <div className="cs-page-foot">
            {ownerName && item.user_id ? (
              <button type="button" className="cs-btn cs-btn-ghost" onClick={() => push("user", { id: item.user_id })}>
                <i className="fa fa-user-o" aria-hidden="true"></i> 去 {ownerName} 的主页
              </button>
            ) : (
              <span className="cs-page-time">{ownerName ? `设定者：${ownerName}` : ""}</span>
            )}
            <span className="cs-page-time">
              {item.published_at ? `发布于 ${formatDate(item.published_at)}` : Number(item.status) === 1 ? "已公开" : "草稿（仅自己可见）"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
