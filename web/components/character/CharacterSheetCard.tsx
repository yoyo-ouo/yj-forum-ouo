"use client";

// ===== 角色设定卡（立绘卡）=====
// 定稿参数：立绘 144px / 卡片圆角 24 / 内边距 16 / 名字 22 / 实色能力胶囊 / 项目青绿。
// 折叠态：立绘 + 名字/称号 + 能力 + 基础档案 + 会馆 + 三图 + 点赞 + 展开；
// 展开态额外展示角色描述、身份/物种、语录。

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

/** 立绘卡。 */
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
  const initial = (sheet.name || "?").trim().slice(0, 1) || "?";
  const isDraft = sheet.status === 0;
  const isHidden = sheet.status === 2;
  const badgeLabel = isHidden ? "已下架" : "草稿";

  return (
    <article className={`cs-card${isDraft ? " is-draft" : ""}`}>
      <div className="cs-hero">
        <div className="cs-portrait">
          {sheet.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sheet.avatar} alt={sheet.name || "角色头像"} />
          ) : (
            <span>{initial}</span>
          )}
        </div>

        <div className="cs-info">
          <div className="cs-name-row">
            <h3 className="cs-name">{sheet.name || "未命名角色"}</h3>
            {sheet.title ? <span className="cs-title">{sheet.title}</span> : null}
            {isDraft || isHidden ? (
              <span className={isHidden ? "cs-badge-hidden" : "cs-badge-draft"}>{badgeLabel}</span>
            ) : null}
          </div>
          {sheet.alias ? <div className="cs-alias">别称 · {sheet.alias}</div> : null}

          {abilities.length > 0 ? (
            <div className="cs-abilities">
              {abilities.map((a, i) => (
                <span key={`${a.category}-${i}`} className={`cs-ab cs-ab-${categoryIndex(a.category)}`}>
                  {abilityLabel(a.category, a.detail)}
                </span>
              ))}
            </div>
          ) : null}

          <div className="cs-meta">
            <span>
              <em>性别</em>
              {genderLabel(sheet.gender)}
            </span>
            <span>
              <em>年龄</em>
              {sheet.age || "—"}
            </span>
          </div>
          <div className="cs-meta">
            <span>
              <em>体态</em>
              {sheet.build || "—"}
            </span>
            {sheet.species ? (
              <span>
                <em>物种</em>
                {sheet.species}
              </span>
            ) : null}
          </div>

          {guildName ? (
            <span className="cs-guild">
              <i className="fa fa-home" aria-hidden="true"></i> {guildName}
            </span>
          ) : null}

          {showOwner && sheet.owner_name ? (
            <div className="cs-owner">
              <i className="fa fa-user-o" aria-hidden="true"></i> {sheet.owner_name} 的设定
            </div>
          ) : null}
        </div>

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

      <div className="cs-body">
        {images.length > 0 ? (
          <div className={`cs-strip cs-strip-${images.length}`}>
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt={`${sheet.name || "角色"} 图片 ${i + 1}`} loading="lazy" />
            ))}
          </div>
        ) : null}

        {expanded ? (
          <div className="cs-more">
            {sheet.identity ? (
              <div className="cs-meta cs-meta-block">
                <span>
                  <em>身份</em>
                  {sheet.identity}
                </span>
              </div>
            ) : null}
            {sheet.description_html ? (
              <RichContent content={sheet.description_html} className="cs-desc" />
            ) : null}
            {quotes.length > 0 ? (
              <div className="cs-quotes">
                {quotes.map((q) => (
                  <blockquote key={q.id} className="cs-quote">
                    {q.content}
                  </blockquote>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {!hideExpand && onToggleExpand ? (
          <button type="button" className={`cs-expand${expanded ? " open" : ""}`} onClick={onToggleExpand}>
            <span>{expanded ? "收起" : "展开更多"}</span>
            <i className="fa fa-angle-down" aria-hidden="true"></i>
          </button>
        ) : null}

        {(onEdit || extraActions) && (
          <div className="cs-card-actions">
            {onEdit ? (
              <button type="button" className="cs-btn cs-btn-ghost" onClick={onEdit}>
                <i className="fa fa-pencil" aria-hidden="true"></i> {editLabel}
              </button>
            ) : null}
            {extraActions}
          </div>
        )}
      </div>
    </article>
  );
}
