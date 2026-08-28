"use client";

import { InlinePrefixBadge } from "../PrefixBadge";

/**
 * 用户头像(含 fa-user fallback)。只渲染 img / fallback 图标本体,
 * 外层容器(wrapper/Link)由调用方决定,以便复用各处不同的布局类。
 */
export function UserAvatar({
  src,
  alt = "",
  imgClassName = "",
  fallbackClassName = "avatar-fallback",
  imgId,
}: {
  src?: string | null;
  alt?: string;
  imgClassName?: string;
  fallbackClassName?: string;
  imgId?: string;
}) {
  if (src) {
    return <img src={src} alt={alt} loading="lazy" className={imgClassName || undefined} id={imgId} />;
  }
  return <i className={`fa fa-user ${fallbackClassName}`}></i>;
}

/** 用户名 + 前缀徽章(不含外层元素/链接,由调用方包装) */
export function UserName({
  name,
  userId,
}: {
  name?: string | null;
  userId?: string | null;
}) {
  return (
    <>
      {name || "匿名"}
      <InlinePrefixBadge userId={userId} />
    </>
  );
}
