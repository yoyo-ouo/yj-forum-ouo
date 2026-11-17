"use client";

// ===== 引用卡片（数据渲染端共用）=====
// 排版属性来自引用节点契约（见 lib/embed.ts）；所有文本均经 React 转义渲染，
// 不使用 dangerouslySetInnerHTML，链接一律站内相对路径。

import Link from "next/link";
import CategoryBadge from "@/components/ui/CategoryBadge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { UserGuildChip } from "@/components/ui/UserGuildChip";
import { EmbedArticleItem, EmbedCharacterItem, EmbedPostItem, EmbedUserItem } from "@/lib/api";
import { timeAgo } from "@/lib/constants";
import { categoryIndex } from "@/lib/character-constants";
import { EmbedResolvedItem, EmbedSpec, hasEmbedField } from "@/lib/embed";

export type QuoteVariant = "card" | "compact";
export type QuoteSize = "sm" | "md" | "lg";
export type QuoteAlign = "left" | "center";

function cardClass(
  kind: "user" | "post" | "article" | "character",
  variant: QuoteVariant,
  size: QuoteSize,
  align: QuoteAlign
): string {
  const cls = ["quote-card", `quote-card-${kind}`, `quote-card-${variant}`, `quote-card-${size}`];
  if (align === "center" && variant === "card") cls.push("quote-card-center");
  return cls.join(" ");
}

/**
 * 卡片外壳：阅读态用站内 Link；编辑器内 interactive=false 用 div。
 * 编辑器必须禁用链接跳转——点击引用是为了选中节点、调整版式，而不是离开未保存的内容。
 */
function CardShell({
  href,
  className,
  interactive,
  children,
}: {
  href: string;
  className: string;
  interactive: boolean;
  children: React.ReactNode;
}) {
  if (!interactive) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** 角色设定引用卡片：头像 + 角色名/称号 + 所属用户 + 能力标签 */
export function CharacterQuoteCard({
  character,
  variant = "card",
  size = "md",
  align = "left",
  interactive = true,
}: {
  character: EmbedCharacterItem;
  variant?: QuoteVariant;
  size?: QuoteSize;
  align?: QuoteAlign;
  interactive?: boolean;
}) {
  const initial = (character.name || "?").slice(0, 1);
  return (
    <CardShell
      href={`/character/${encodeURIComponent(character.id)}`}
      className={cardClass("character", variant, size, align)}
      interactive={interactive}
    >
      <span className="quote-card-avatar quote-card-char-avatar">
        {character.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={character.avatar} alt="" />
        ) : (
          initial
        )}
      </span>
      <span className="quote-card-body">
        <span className="quote-card-name-row">
          <span className="quote-card-name">{character.name || "未命名角色"}</span>
          {character.title ? <span className="quote-card-char-title">{character.title}</span> : null}
        </span>
        {variant === "card" ? (
          <span className="quote-card-char-owner">
            <i className="fa fa-user-o" aria-hidden="true"></i> {character.owner_name || "未知用户"} 的设定
          </span>
        ) : null}
        {variant === "card" && character.abilities.length > 0 ? (
          <span className="quote-card-char-abilities">
            {character.abilities.slice(0, 3).map((a) => (
              <span key={a} className={`quote-card-char-ab quote-card-char-ab-${categoryIndex(a)}`}>
                {a}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </CardShell>
  );
}

/** 用户引用卡片：头像（含前缀角标）+ 昵称 + 会馆 chip + 简介 */
export function UserQuoteCard({
  user,
  variant = "card",
  size = "md",
  fields = null,
  align = "left",
  interactive = true,
}: {
  user: EmbedUserItem;
  variant?: QuoteVariant;
  size?: QuoteSize;
  fields?: string | null;
  align?: QuoteAlign;
  interactive?: boolean;
}) {
  const guild = user.guild;
  const showGuild = hasEmbedField(fields, "guild") && !!guild;
  // 紧凑版式不展示简介（字段开关仍作用于会馆）
  const showIntro = variant === "card" && hasEmbedField(fields, "intro");
  return (
    <CardShell href={`/users/${encodeURIComponent(user.id)}`} className={cardClass("user", variant, size, align)} interactive={interactive}>
      <span className="quote-card-avatar">
        <UserAvatar src={user.avatar} alt={user.name} userId={user.id} />
      </span>
      <span className="quote-card-body">
        <span className="quote-card-name-row">
          <span className="quote-card-name">{user.name}</span>
          {showGuild && guild && <UserGuildChip name={guild.name} color={guild.theme_color} />}
        </span>
        {showIntro && <span className="quote-card-intro">{user.intro || "这个人很懒，什么都没留下～"}</span>}
      </span>
    </CardShell>
  );
}

/** 帖子引用卡片：标题 + 作者/分类/会馆/时间 */
export function PostQuoteCard({
  post,
  variant = "card",
  size = "md",
  align = "left",
  interactive = true,
}: {
  post: EmbedPostItem;
  variant?: QuoteVariant;
  size?: QuoteSize;
  align?: QuoteAlign;
  interactive?: boolean;
}) {
  return (
    <CardShell href={`/post/${encodeURIComponent(post.id)}`} className={cardClass("post", variant, size, align)} interactive={interactive}>
      <span className="quote-card-head">
        <i className="fa fa-file-text-o"></i>
        <span className="quote-card-kind">帖子</span>
      </span>
      <span className="quote-card-title">{post.title || "无标题"}</span>
      <span className="quote-card-meta">
        <span className="quote-card-meta-item">
          <i className="fa fa-user-o"></i> {post.user_name}
        </span>
        <CategoryBadge category={post.category} className="quote-card-category" />
        {post.guild_name && (
          <span className="quote-card-meta-item">
            <i className="fa fa-home"></i> {post.guild_name}
          </span>
        )}
        {variant === "card" && (
          <span className="quote-card-meta-item">
            <i className="fa fa-clock-o"></i> {timeAgo(post.created_at)}
          </span>
        )}
      </span>
    </CardShell>
  );
}

/** 文章引用卡片：标题 + 作者/会馆/时间 */
export function ArticleQuoteCard({
  article,
  variant = "card",
  size = "md",
  align = "left",
  interactive = true,
}: {
  article: EmbedArticleItem;
  variant?: QuoteVariant;
  size?: QuoteSize;
  align?: QuoteAlign;
  interactive?: boolean;
}) {
  return (
    <CardShell href={`/article/${encodeURIComponent(article.id)}`} className={cardClass("article", variant, size, align)} interactive={interactive}>
      <span className="quote-card-head">
        <i className="fa fa-book"></i>
        <span className="quote-card-kind">文章</span>
      </span>
      <span className="quote-card-title">{article.title || "无标题"}</span>
      <span className="quote-card-meta">
        {article.author_name && (
          <span className="quote-card-meta-item">
            <i className="fa fa-pencil"></i> {article.author_name}
          </span>
        )}
        {article.guild_name && (
          <span className="quote-card-meta-item">
            <i className="fa fa-home"></i> {article.guild_name}
          </span>
        )}
        {variant === "card" && (
          <span className="quote-card-meta-item">
            <i className="fa fa-clock-o"></i> {timeAgo(article.created_at)}
          </span>
        )}
      </span>
    </CardShell>
  );
}

/** 加载中骨架 */
export function QuoteCardSkeleton({ variant = "card" }: { variant?: QuoteVariant }) {
  return (
    <div className={`quote-card quote-card-skeleton quote-card-${variant}`} aria-busy="true">
      <span className="quote-card-avatar quote-skeleton-block"></span>
      <span className="quote-card-body">
        <span className="quote-card-skeleton-line quote-skeleton-block"></span>
        <span className="quote-card-skeleton-line quote-card-skeleton-line-short quote-skeleton-block"></span>
      </span>
    </div>
  );
}

/** 内容已删除/不可用占位 */
export function QuoteCardMissing() {
  return (
    <div className="quote-card quote-card-missing">
      <i className="fa fa-chain-broken"></i> 内容已删除或不可用
    </div>
  );
}

/** 按引用节点属性分发到对应卡片；data 为 null（已删除/不可用）时渲染占位 */
export function QuoteCard({
  spec,
  data,
  interactive = true,
}: {
  spec: EmbedSpec;
  data: EmbedResolvedItem | null;
  /** 编辑器内传 false：渲染为普通容器，点击由 TipTap 选中节点，不跳转 */
  interactive?: boolean;
}) {
  if (!data) return <QuoteCardMissing />;
  if (data.type === "user" && spec.type === "user") {
    return <UserQuoteCard user={data.user} variant={spec.variant} size={spec.size} fields={spec.fields} align={spec.align} interactive={interactive} />;
  }
  if (data.type === "post" && spec.type === "post") {
    return <PostQuoteCard post={data.post} variant={spec.variant} size={spec.size} align={spec.align} interactive={interactive} />;
  }
  if (data.type === "article" && spec.type === "article") {
    return <ArticleQuoteCard article={data.article} variant={spec.variant} size={spec.size} align={spec.align} interactive={interactive} />;
  }
  if (data.type === "character" && spec.type === "character") {
    return (
      <CharacterQuoteCard character={data.character} variant={spec.variant} size={spec.size} align={spec.align} interactive={interactive} />
    );
  }
  return <QuoteCardMissing />;
}

export default QuoteCard;
