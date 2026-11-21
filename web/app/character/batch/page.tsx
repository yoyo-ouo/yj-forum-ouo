"use client";

// ===== 批量添加 OC（独立页）=====
// 分工：服务端负责全部解析/校验/配额；本页只负责输入、展示服务端结果、发起预览与提交。
// 预览不创建任何角色；正式创建必须带预览凭证并满足服务端 3 秒等待。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CharacterBatchCard from "@/components/character/CharacterBatchCard";
import CharacterBatchConfirmModal from "@/components/character/CharacterBatchConfirmModal";
import { useToast } from "@/components/Toast";
import { useStore } from "@/lib/store";
import { ApiException } from "@/lib/api";
import {
  batchErrorsFrom,
  characterApi,
  type CharacterBatchCreatedItem,
  type CharacterBatchError,
  type CharacterBatchPreview,
  type CharacterQuota,
} from "@/lib/api/character";
import { CHARACTER_LIMITS } from "@/lib/character-constants";

const SAMPLE = [
  "A：name-白夜|alias-夜|title-守灯人|gender-1|age-20|build-修长|species-人类|identity-旅人|description-总在灯下等到最后一个路人。|ability-御灵系:灯影|quote-灯不必亮，路自会让人看见。|quotes_visible-true",
  "B：name-黑夜|gender-2|age-21|ability-空间系:空间折叠|quote-我一直在这里。",
].join("\n");

function quotaText(quota: CharacterQuota | null): string {
  if (!quota) return "配额加载中…";
  return `当前角色数量：${quota.used} / ${quota.max}，剩余可创建：${quota.remaining}`;
}

export default function CharacterBatchPage() {
  const { user, loadingUser } = useStore();
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 记录最新原文：预览请求返回时若已被修改，丢弃过期响应
  const contentRef = useRef("");

  const [quota, setQuota] = useState<CharacterQuota | null>(null);
  const [quotaError, setQuotaError] = useState("");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<CharacterBatchPreview | null>(null);
  const [parseErrors, setParseErrors] = useState<CharacterBatchError[]>([]);
  const [parseMessage, setParseMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<CharacterBatchCreatedItem[] | null>(null);
  // 每次打开确认框换 key，让倒计时组件重新挂载（关闭再打开必须重新计时）
  const [confirmSession, setConfirmSession] = useState(0);

  const loadQuota = useCallback(async () => {
    if (!user) return;
    try {
      const r = await characterApi.quota();
      setQuota(r.quota);
      setQuotaError("");
    } catch (e) {
      setQuotaError(e instanceof ApiException ? e.message : "配额加载失败");
    }
  }, [user]);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  const lineCount = useMemo(
    () => content.split("\n").filter((l) => l.trim()).length,
    [content]
  );

  const handleContentChange = (value: string) => {
    contentRef.current = value;
    setContent(value);
    // 修改原文后旧预览（含凭证）立即失效，必须重新解析
    if (preview) setPreview(null);
    if (confirmOpen) setConfirmOpen(false);
    if (parseErrors.length > 0) {
      setParseErrors([]);
      setParseMessage("");
    }
    if (submitError) setSubmitError("");
  };

  const handlePreview = async () => {
    if (!content.trim()) {
      toast("请先粘贴批量文本", "info");
      textareaRef.current?.focus();
      return;
    }
    setBusy(true);
    setParseErrors([]);
    setParseMessage("");
    setSubmitError("");
    setPreview(null);
    const requested = content;
    try {
      const r = await characterApi.batchPreview(requested);
      // 请求期间用户改了原文：旧响应（含凭证）已失效
      if (contentRef.current !== requested) return;
      setPreview(r);
      setQuota(r.quota);
      if (!r.within_quota) {
        toast("本次数量超出剩余配额，无法继续", "error");
      } else {
        toast(`解析成功：${r.count} 个角色`, "success");
      }
    } catch (e) {
      if (contentRef.current !== requested) return;
      const errs = batchErrorsFrom(e);
      setParseErrors(errs);
      setParseMessage(e instanceof ApiException ? e.message : "解析失败");
      toast(e instanceof ApiException ? e.message : "解析失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const openConfirm = () => {
    if (!preview || !preview.token || !preview.within_quota) return;
    setSubmitError("");
    setConfirmSession((v) => v + 1);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!preview?.token) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const r = await characterApi.batchCreate(content, preview.token);
      setCreated(r.items);
      setQuota(r.quota);
      setPreview(null);
      setConfirmOpen(false);
      toast(`已创建 ${r.count} 个角色草稿`, "success");
    } catch (e) {
      const errs = batchErrorsFrom(e);
      if (errs.length > 0) setParseErrors(errs);
      const msg = e instanceof ApiException ? e.message : "批量创建失败";
      setSubmitError(msg);
      toast(msg, "error");
      const code = e instanceof ApiException ? e.code : undefined;
      if (code === "PREVIEW_INVALID" || code === "PREVIEW_EXPIRED") {
        setPreview(null);
        setConfirmOpen(false);
      }
      if (code === "QUOTA_EXCEEDED") {
        setConfirmOpen(false);
        setPreview(null);
        void loadQuota();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetForNext = () => {
    setCreated(null);
    setContent("");
    setPreview(null);
    setParseErrors([]);
    setParseMessage("");
    setSubmitError("");
    void loadQuota();
  };

  // ---- 未登录 / 初次加载 ----
  if (loadingUser) {
    return (
      <div className="cb-page">
        <p className="cb-loading">加载中…</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="cb-page">
        <div className="cb-card cb-login">
          <i className="fa fa-lock" aria-hidden="true"></i>
          <h1>登录后才能批量添加 OC</h1>
          <p>批量创建的角色会归入你的账号，因此需要先登录。</p>
          <Link href="/auth" className="cb-btn cb-btn-primary">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  // ---- 创建成功 ----
  if (created) {
    return (
      <div className="cb-page">
        <header className="cb-head">
          <div>
            <h1>批量添加完成</h1>
            <p>已创建 {created.length} 个角色草稿，它们不会自动发布，也不会自动加入会馆。</p>
          </div>
        </header>

        <section className="cb-card cb-success">
          <p className="cb-success-title">
            <i className="fa fa-check" aria-hidden="true"></i> 本次创建的角色
          </p>
          <ul className="cb-success-list">
            {created.map((c) => (
              <li key={c.id}>
                <span className="cb-char-id">{c.identifier}</span>
                <span className="cb-success-name">{c.name || "未命名角色"}</span>
                <span className="cb-success-hint">草稿</span>
              </li>
            ))}
          </ul>
          <p className="cb-success-quota">{quotaText(quota)}</p>
          <div className="cb-actions">
            <Link href={`/users/${encodeURIComponent(user.id)}#user-character`} className="cb-btn cb-btn-primary">
              去我的主页完善
            </Link>
            <button type="button" className="cb-btn cb-btn-ghost" onClick={resetForNext}>
              继续批量添加
            </button>
          </div>
          <p className="cb-hint">
            <i className="fa fa-info-circle" aria-hidden="true"></i>
            草稿只有你自己能看到：到「我的主页 → 设定信息」选中角色继续完善，点「完成并公开」后才会出现在主页。
          </p>
        </section>
      </div>
    );
  }

  const canConfirm = Boolean(preview && preview.token && preview.within_quota && parseErrors.length === 0);
  const overBy = preview && !preview.within_quota ? preview.count - preview.quota.remaining : 0;

  return (
    <div className="cb-page">
      <header className="cb-head">
        <div>
          <Link href={`/users/${encodeURIComponent(user.id)}#user-character`} className="cb-back">
            <i className="fa fa-arrow-left" aria-hidden="true"></i> 返回角色设定列表
          </Link>
          <h1>批量添加 OC</h1>
          <p>一次粘贴多个角色设定，服务端解析并统一创建为草稿。</p>
        </div>
        <Link href="/character/batch/rules" className="cb-btn cb-btn-ghost">
          <i className="fa fa-book" aria-hidden="true"></i> 查看批量添加规则
        </Link>
      </header>

      <section className="cb-quota" aria-label="角色配额">
        <div className="cb-quota-item">
          <span>当前角色数量</span>
          <b>{quota ? quota.used : "—"}</b>
        </div>
        <div className="cb-quota-item">
          <span>最大角色数量</span>
          <b>{quota ? quota.max : CHARACTER_LIMITS.maxPerUser}</b>
        </div>
        <div className="cb-quota-item cb-quota-remaining">
          <span>剩余可创建</span>
          <b>{quota ? quota.remaining : "—"}</b>
        </div>
        {quotaError ? <p className="cb-error-inline">{quotaError}</p> : null}
      </section>

      <section className="cb-card">
        <div className="cb-card-head">
          <h2>
            <i className="fa fa-pencil-square-o" aria-hidden="true"></i> 批量文本
          </h2>
          <div className="cb-tools">
            <button type="button" className="cb-tool" onClick={() => handleContentChange(SAMPLE)}>
              插入示例
            </button>
            <button
              type="button"
              className="cb-tool"
              onClick={() => handleContentChange("")}
              disabled={!content}
            >
              清空
            </button>
          </div>
        </div>
        <p className="cb-hint">
          每行一个角色：<code>角色标识符：属性标识符-属性值|属性标识符-属性值</code>. 角色标识符用单个英文字母。
        </p>
        <textarea
          ref={textareaRef}
          className="cb-textarea"
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          disabled={busy}
          placeholder={"例如：\nA：name-白夜|age-20|ability-御灵系:灯影\nB：name-黑夜|age-21|quote-我一直在这里。"}
          spellCheck={false}
          rows={12}
          aria-label="批量角色文本"
        />
        <div className="cb-input-foot">
          <span className="cb-count">
            {lineCount} 行 · {content.length} 字符（单次最多 {CHARACTER_LIMITS.batchCharacters} 个角色）
          </span>
          <button
            type="button"
            className="cb-btn cb-btn-primary"
            onClick={() => void handlePreview()}
            disabled={busy || !content.trim()}
          >
            {busy ? (
              <>
                <i className="fa fa-spinner fa-spin" aria-hidden="true"></i> 解析中…
              </>
            ) : (
              <>
                <i className="fa fa-search" aria-hidden="true"></i> 解析预览
              </>
            )}
          </button>
        </div>
        <p className="cb-hint">
          <i className="fa fa-shield" aria-hidden="true"></i> 预览只在服务端解析，不会创建或修改任何角色。
        </p>
      </section>

      {parseErrors.length > 0 ? (
        <section className="cb-card cb-errors" role="alert">
          <h2>
            <i className="fa fa-exclamation-triangle" aria-hidden="true"></i> {parseMessage || "解析失败"}
          </h2>
          <p className="cb-hint">存在以下问题时无法创建，整个批次都会被拒绝。请修正后重新解析。</p>
          <ul>
            {parseErrors.map((e, i) => (
              <li key={`${e.line}-${e.code}-${i}`}>
                <span className="cb-err-line">{e.line ? `第 ${e.line} 行` : "批次"}</span>
                {e.identifier ? <span className="cb-err-id">{e.identifier}</span> : null}
                {e.field ? <code className="cb-err-field">{e.field}</code> : null}
                <span className="cb-err-code">{e.code}</span>
                <span className="cb-err-msg">{e.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {preview ? (
        <section className="cb-preview">
          <div className="cb-preview-head">
            <div>
              <h2>解析结果（{preview.count} 个）</h2>
              <p>
                本次准备创建：<b>{preview.count}</b> 个 · 剩余配额：<b>{preview.quota.remaining}</b> 个 · 创建后剩余：
                <b className={preview.quota.remaining - preview.count < 0 ? "is-bad" : ""}>{preview.quota.remaining - preview.count}</b> 个
              </p>
            </div>
            {!preview.within_quota ? (
              <p className="cb-quota-bad">
                超出剩余配额 {overBy} 个，无法继续。
              </p>
            ) : null}
          </div>

          <div className="cb-preview-grid">
            {preview.items.map((item) => (
              <CharacterBatchCard key={`${item.identifier}-${item.line}`} item={item} />
            ))}
          </div>

          <div className="cb-preview-foot">
            <button
              type="button"
              className="cb-btn cb-btn-ghost"
              onClick={() => {
                textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                textareaRef.current?.focus();
              }}
            >
              <i className="fa fa-pencil" aria-hidden="true"></i> 返回编辑
            </button>
            <button
              type="button"
              className="cb-btn cb-btn-ghost"
              onClick={() => void handlePreview()}
              disabled={busy}
            >
              <i className="fa fa-refresh" aria-hidden="true"></i> 重新解析
            </button>
            <button type="button" className="cb-btn cb-btn-primary" onClick={openConfirm} disabled={!canConfirm}>
              <i className="fa fa-check" aria-hidden="true"></i> 确认批量添加
            </button>
          </div>
          {!preview.within_quota ? (
            <p className="cb-hint cb-hint-bad">请减少本次创建数量，或先删除已有角色后再试。</p>
          ) : null}
        </section>
      ) : null}

      <CharacterBatchConfirmModal
        key={confirmSession}
        open={confirmOpen}
        items={preview?.items || []}
        quota={preview?.quota || quota || { used: 0, max: CHARACTER_LIMITS.maxPerUser, remaining: 0 }}
        submitting={submitting}
        error={submitError}
        onClose={() => {
          if (submitting) return;
          setConfirmOpen(false);
        }}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  );
}
