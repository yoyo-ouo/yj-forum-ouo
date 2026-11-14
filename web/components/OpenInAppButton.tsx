"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useToast } from "@/components/Toast";

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** 微信 / QQ / 微博等内置浏览器会拦截自定义 scheme */
function detectInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /MicroMessenger|QQ\/|Weibo|AlipayClient|DingTalk/i.test(ua);
}

// UA 在页面生命周期内不变，无需订阅（但保持稳定的 subscribe 引用）。
const subscribe = () => () => {};

function usePlatform(): Platform {
  return useSyncExternalStore(subscribe, detectPlatform, () => "other" as Platform);
}

function useInAppBrowser(): boolean {
  return useSyncExternalStore(subscribe, detectInAppBrowser, () => false);
}

/**
 * 「在客户端打开」入口（帖子页 / 下载页）。
 *
 * - 仅移动端渲染（桌面端没有 yjlt:// 客户端，不展示）
 * - 链接走 NSH 客户端注册的 `yjlt://` scheme；帖子页带 id 直达详情
 * - 未安装客户端时旁边给下载入口；微信/QQ 内提示用系统浏览器打开
 */
export default function OpenInAppButton({
  postId,
  className = "",
  label = "在客户端打开",
  showDownloadLink = true,
  variant = "inline",
}: {
  postId?: string;
  className?: string;
  label?: string;
  /** 下载页自身不用再显示「未安装？下载客户端」 */
  showDownloadLink?: boolean;
  /** inline：独立一行；action：帖子操作栏里的一个按钮（图标 + 短文案） */
  variant?: "inline" | "action";
}) {
  // 内置浏览器判断：服务端快照 false，客户端算完 UA 后重渲染。
  const inAppBrowser = useInAppBrowser();
  const platform = usePlatform();
  const isMobile = platform === "ios" || platform === "android";
  // 桌面端用显示器图标，移动端用手机图标
  const icon = isMobile ? "fa-mobile" : "fa-desktop";
  const { toast } = useToast();

  const href = postId ? `yjlt://posts/${encodeURIComponent(postId)}` : "yjlt://";

  const open = () => {
    if (inAppBrowser) {
      toast("微信 / QQ 内无法直接唤起客户端，请点右上角「在浏览器打开」后重试", "warning");
      return;
    }
    window.location.href = href;
  };

  // 帖子操作栏模式：与点赞/收藏同一排，图标 + 短文案
  if (variant === "action") {
    return (
      <button
        type="button"
        className={`post-action-btn open-in-app-action ${className}`.trim()}
        onClick={open}
        aria-label={label}
      >
        <i className={`fa ${icon}`} aria-hidden="true"></i>
        <span className="post-action-label">{label}</span>
      </button>
    );
  }

  return (
    <div className={`open-in-app ${className}`.trim()}>
      <button type="button" className="open-in-app-btn" onClick={open}>
        <i className={`fa ${icon}`} aria-hidden="true"></i>
        <span>{label}</span>
      </button>
      {showDownloadLink && (
        <Link href="/download" className="open-in-app-download">
          未安装？下载客户端
        </Link>
      )}
    </div>
  );
}
