"use client";

// ===== 角色设定卡（分区档案卡）=====
// 版式：顶部一行「头像 + 名字/称号 + 显示更多」；下方四格属性、身份行、能力/会馆/点赞一行。
// 折叠态只给「一眼认清是谁」的信息；图片、描述、语录一律收进展开态。
// 头像内嵌于卡片内边距中（圆角方形），不再贴卡片顶角。

import type { ReactNode } from "react";
import RichContent from "@/components/ui/RichContent";
import { categoryIndex, genderLabel } from "@/lib/character-constants";
import { characterMediaUrl, type CharacterSheet } from "@/lib/api/character";

export interface CharacterSheetCardProps {
  sheet: CharacterSheet;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onLike?: () => void;
  onEdit?: () => void;
  editLabel?: string;
  extraActions?: ReactNode;
  /** 是否已在外部展示展开内容（独立页），隐藏展开按钮 */
  hideExpand?: boolean;
  /** 是否显示「所属用户」行（引用卡片/成员页场景） */
  showOwner?: boolean;
}

/** 能力标签文本：有具体能力时用「系 · 具体」 */
function abilityLabel(category: string, detail: string): string {
  return detail ? `${category} · ${detail}` : category;
}

/** 分区档案卡。 */
export default function CharacterSheetCard({
  sheet,
  expanded = false,
  onToggleExpand,
  onLike,
  onEdit,
  editLabel = "编辑",
  extraActions,
  hideExpand = false,
  showOwner = false,
}: CharacterSheetCardProps) {
  const abilities = sheet.abilities || [];
  const images = (sheet.images || []).map(characterMediaUrl).filter(Boolean);
  const quotes = (sheet.quotes || []).filter((q) => q.content && q.content.trim());
  const guildName = sheet.guild_id ? sheet.guild_name : sheet.guild_custom_name;
  const initial = Array.from((sheet.name || "?").trim())[0] || "?";
  const isDraft = sheet.status === 0;
  const isHidden = sheet.status === 2;
  const badgeLabel = isHidden ? "已下架" : "草稿";
  // 展开态才有内容：图片、描述、语录全部收在这里
  const hasMore = Boolean(sheet.description_html) || images.length > 0 || quotes.length > 0;
  // 没有可展开内容时不显示「显示更多」（空草稿卡点了也不会有东西）
  const showExpand = !hideExpand && Boolean(onToggleExpand) && hasMore;
  const showActions = showExpand || Boolean(onEdit) || Boolean(extraActions);

  return (
    <article className={`cs-card${isDraft ? " is-draft" : ""}${isHidden ? " is-hidden" : ""}`}>
      {/* 顶部：头像 + 身份 + 右上角操作 */}
      <div className="cs-head">
        <div className="cs-avatar">
          {sheet.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sheet.avatar} alt={sheet.name || "角色头像"} />
          ) : (
            <span>{initial}</span>
          )}
        </div>

        <div className="cs-id">
          <div className="cs-name-row">
            <h3 className="cs-name">{sheet.name || "未命名角色"}</h3>
            {sheet.title ? <span className="cs-title">{sheet.title}</span> : null}
            {isDraft || isHidden ? (
              <span className={isHidden ? "cs-badge-hidden" : "cs-badge-draft"}>{badgeLabel}</span>
            ) : null}
          </div>
          {sheet.alias || (showOwner && sheet.owner_name) ? (
            <div className="cs-sub">
              {sheet.alias ? <span className="cs-alias">别称 · {sheet.alias}</span> : null}
              {showOwner && sheet.owner_name ? (
                <span className="cs-owner">
                  <i className="fa fa-user-o" aria-hidden="true"></i> {sheet.owner_name} 的设定
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {showActions ? (
          <div className="cs-head-actions">
            {onEdit ? (
              <button
                type="button"
                className="cs-btn cs-btn-ghost cs-edit-btn"
                aria-label={editLabel}
                onClick={onEdit}
              >
                <i className="fa fa-pencil" aria-hidden="true"></i>
                <span className="cs-edit-label">{editLabel}</span>
              </button>
            ) : null}
            {extraActions}
            {showExpand ? (
              <button
                type="button"
                className={`cs-more-btn${expanded ? " open" : ""}`}
                aria-expanded={expanded}
                onClick={onToggleExpand}
              >
                <span>{expanded ? "收起" : "显示更多"}</span>
                <i className="fa fa-angle-down" aria-hidden="true"></i>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 四格属性 */}
      <dl className="cs-attrs">
        <div className="cs-attr">
          <dt>性别</dt>
          <dd>{genderLabel(sheet.gender)}</dd>
        </div>
        <div className="cs-attr">
          <dt>年龄</dt>
          <dd>{sheet.age || "—"}</dd>
        </div>
        <div className="cs-attr">
          <dt>体态</dt>
          <dd>{sheet.build || "—"}</dd>
        </div>
        <div className="cs-attr">
          <dt>物种</dt>
          <dd>{sheet.species || "—"}</dd>
        </div>
      </dl>

      {sheet.identity ? (
        <div className="cs-idline">
          <em>身份</em>
          <span>{sheet.identity}</span>
        </div>
      ) : null}

      {/* 能力 / 会馆 / 点赞 */}
      <div className="cs-bottom">
        {abilities.length > 0 ? (
          <div className="cs-abilities">
            {abilities.map((a, i) => (
              <span key={`${a.category}-${i}`} className={`cs-ab cs-ab-${categoryIndex(a.category)}`}>
                {abilityLabel(a.category, a.detail)}
              </span>
            ))}
          </div>
        ) : (
          <span className="cs-bottom-spacer" />
        )}

        <div className="cs-end">
          {guildName ? (
            <span className="cs-guild" title={guildName}>
              <i className="fa fa-home" aria-hidden="true"></i> {guildName}
            </span>
          ) : null}
          {onLike ? (
            <button
              type="button"
              className={`cs-like${sheet.liked ? " active" : ""}`}
              aria-pressed={sheet.liked}
              aria-label={sheet.liked ? "取消点赞" : "点赞"}
              onClick={onLike}
            >
              <i className={`fa ${sheet.liked ? "fa-heart" : "fa-heart-o"}`} aria-hidden="true"></i>
              <b>{sheet.like_count || 0}</b>
            </button>
          ) : (
            <span className="cs-like cs-like-static">
              <i className="fa fa-heart-o" aria-hidden="true"></i>
              <b>{sheet.like_count || 0}</b>
            </span>
          )}
        </div>
      </div>

      {/* 展开态：卷首引言 → 角色描述 → 图集 */}
      {expanded && hasMore ? (
        <div className="cs-more">
          {quotes.length > 0 ? (
            <div className="cs-lead-quote">
              <span className="cs-lead-qm" aria-hidden="true">
                “
              </span>
              {quotes.map((q) => (
                <p key={q.id} className="cs-lead-line">
                  {q.content}
                </p>
              ))}
            </div>
          ) : null}

          {sheet.description_html ? (
            <section className="cs-block">
              <h4 className="cs-block-title">角色描述</h4>
              <RichContent content={sheet.description_html} className="cs-desc" />
            </section>
          ) : null}

          {images.length > 0 ? (
            <section className="cs-block">
              <h4 className="cs-block-title">
                图集<span className="cs-block-count">{images.length}</span>
              </h4>
              <div className={`cs-strip cs-strip-${images.length}`}>
                {images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src} src={src} alt={`${sheet.name || "角色"} 图片 ${i + 1}`} loading="lazy" />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
