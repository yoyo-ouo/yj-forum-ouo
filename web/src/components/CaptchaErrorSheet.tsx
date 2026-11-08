import React, { useEffect, useState } from "react";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { clearCaptcha, getCaptchaStatus } from "../lib/native";
import { Sheet } from "./mobile";
import { Icon } from "./icons";
import type { AppInfo, CaptchaErrorCode, CaptchaStatus } from "../lib/types";

interface Copy {
  title: string;
  body: string;
  hint: string;
}

/** 不出现任何求解/PoW 字眼：用户只需知道“验证没通过、可以怎么做”。 */
const COPY: Record<CaptchaErrorCode, Copy> = {
  DISABLED: {
    title: "站点验证未开启",
    body: "服务端暂未启用人机验证，提交被拒绝了。通常是站点刚更新、配置还没生效。",
    hint: "稍等几分钟再试；若一直这样，请联系管理员检查配置。",
  },
  APP_DISABLED: {
    title: "APP 验证通道未开启",
    body: "服务端还没有开启 APP 专用验证通道，当前客户端无法完成验证。",
    hint: "请联系管理员开启该通道，或先在网页端完成操作。",
  },
  MISSING_SECRET: {
    title: "客户端验证密钥缺失",
    body: "当前安装包没有内置验证密钥，无法向服务端证明身份。",
    hint: "请安装官方发布的最新版本；自己构建的包需要补上密钥。",
  },
  SECRET_MISMATCH: {
    title: "验证密钥不一致",
    body: "客户端与服务端的验证密钥对不上，所以每次都被判为未通过。",
    hint: "请联系管理员核对服务端配置，或换用官方安装包。",
  },
  RATE_LIMITED: {
    title: "验证太频繁",
    body: "短时间内重复提交，被服务端限流了。",
    hint: "等一两分钟再试，期间不要连续点提交。",
  },
  NETWORK: {
    title: "验证服务连不上",
    body: "请求没有拿到验证结果，可能是网络不稳定或服务端正在维护。",
    hint: "切换网络后重试；依旧不行就稍后再来。",
  },
  REJECTED: {
    title: "验证未通过",
    body: "这次提交没有通过人机验证，可能是凭证过期或被服务端拒绝。",
    hint: "点「重试」刷新验证状态后重新提交即可。",
  },
};

const CODE_LABEL: Record<CaptchaErrorCode, string> = {
  DISABLED: "服务端未开启验证",
  APP_DISABLED: "APP 验证通道未开启",
  MISSING_SECRET: "客户端密钥缺失",
  SECRET_MISMATCH: "密钥不一致",
  RATE_LIMITED: "验证请求过于频繁",
  NETWORK: "验证服务不可达",
  REJECTED: "验证凭证被拒绝",
};

function buildDiagnostics(code: CaptchaErrorCode, status: CaptchaStatus | null, appInfo: AppInfo | null): string {
  const lines = [
    "妖精论坛 APP 验证诊断",
    `时间：${new Date().toLocaleString("zh-CN")}`,
    `分类：${code}（${CODE_LABEL[code]}）`,
    `版本：${appInfo?.versionName || "未知"}（${appInfo?.versionCode ?? "-"}）`,
    `包名：${appInfo?.packageName || "未知"}`,
    `接口：${appInfo?.apiBase || "未知"}`,
    `服务端验证：${status ? (status.enabled ? "已开启" : "未开启") : "未知"}`,
    `APP 通道：${status ? (status.app_enabled ? "已开启" : "未开启") : "未知"}`,
    `客户端密钥：${status?.client_secret_configured === undefined ? "未知" : status.client_secret_configured ? "已内置" : "缺失"}`,
  ];
  return lines.join("\n");
}

/** 复制文本：优先 Clipboard API，WebView 不支持时降级到 execCommand。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续降级 */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 验证失败说明弹层：读 store.captchaError，任何接口拿到验证失败都会自动弹出。 */
export function CaptchaErrorSheet() {
  const code = useApp((state) => state.captchaError);
  const appInfo = useApp((state) => state.appInfo);
  const clearCaptchaError = useApp((state) => state.clearCaptchaError);
  const showToast = useApp((state) => state.showToast);
  const { push } = useNav();
  const [status, setStatus] = useState<CaptchaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    void getCaptchaStatus()
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [code]);

  if (!code) return null;
  // 未知分类（原生壳新旧版本差异）统一按 REJECTED 展示，保证总有文案
  const copy = COPY[code] ?? COPY.REJECTED;

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearCaptcha().catch(() => undefined);
      clearCaptchaError();
      showToast("已刷新验证状态，请重新提交");
    } finally {
      setBusy(false);
    }
  };

  const copyDiagnostics = async (): Promise<boolean> => {
    const text = buildDiagnostics(code, status, appInfo);
    if (await copyText(text)) {
      showToast("诊断信息已复制");
      return true;
    }
    showToast("复制失败，请手动记录分类编号", "error");
    return false;
  };

  const contactAdmin = async () => {
    await copyDiagnostics();
    clearCaptchaError();
    push("feedback");
  };

  return (
    <Sheet
      open
      title={<span className="cap-title"><Icon name="shield" size={18} />{copy.title}</span>}
      onClose={clearCaptchaError}
      footer={
        <>
          <button className="m-btn m-btn--ghost" onClick={retry} disabled={busy}>
            {busy ? "刷新中…" : "重试"}
          </button>
          <button className="m-btn m-btn--primary" onClick={() => void copyDiagnostics()}>
            复制诊断
          </button>
        </>
      }
    >
      <p className="cap-body">{copy.body}</p>
      <p className="cap-hint">{copy.hint}</p>
      <button className="cap-contact" type="button" onClick={() => void contactAdmin()}>
        <Icon name="mail" size={16} />联系管理员
      </button>
      <div className="cap-meta">
        <span>分类：{code}</span>
        {status ? <span>通道：{status.app_enabled ? "APP 已开启" : "APP 未开启"}</span> : null}
      </div>
    </Sheet>
  );
}
