import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { RichEditor } from "../components/RichEditor";
import { CATEGORY_LABELS, contrastText } from "../lib/format";
// 仅本页需要的移动端适配（Web 页头吸顶 / 收窄内边距），不改 main.tsx 与共享样式
import "../styles/search-compose-auth-page.css";

/* ======================= 常量（口径对齐 Web app/post/create/page.tsx） ======================= */

const COMPLIANCE = [
  "遵守中华人民共和国相关法律法规，不得发布违法违规内容",
  "禁止涉及政治敏感、涉黄涉暴、血腥恐怖、毒品赌博等内容",
  "禁止人身攻击、谩骂侮辱、恶意引战、网络暴力等行为",
  "禁止发布广告、 spam、外链刷量、引流等垃圾信息",
  "禁止泄露他人或自己的隐私信息（真实姓名、电话、地址等）",
  "禁止侵犯他人知识产权，转载请注明出处或获得授权",
  "内容应与论坛主题（罗小黑战记及二次元文化）相关，鼓励友善交流",
  "违反以上规定的帖子将被删除，情节严重者将封禁账号",
];

const PUBLIC_CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

/** 与服务端一致的正文原始字节上限（256KB） */
const MAX_POST_CONTENT_BYTES = 256 * 1024;
/** 定时发布时间约束：最早当前时间 +5 分钟，最晚 +1 年 */
const SCHEDULE_MIN_AHEAD_MS = 5 * 60 * 1000;
const SCHEDULE_MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** 富文本是否为空（无文本且无图片）：编辑器空文档序列化为 <p></p> */
function hasRichContent(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return !!text || /<img\b/i.test(html);
}

/** UTF-8 字节数（提交前提示，服务端仍会二次校验） */
function contentByteLength(html: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(html).length;
  return html.length * 3;
}

/** 本地时区 YYYY-MM-DDTHH:mm（datetime-local 的 min/max 口径） */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 向上取整到下一整分钟（分钟粒度下保证 min 提交时依旧有效） */
function ceilToMinute(time: number): Date {
  const date = new Date(time);
  if (date.getSeconds() > 0 || date.getMilliseconds() > 0) date.setMinutes(date.getMinutes() + 1);
  date.setSeconds(0, 0);
  return date;
}

/** 定时范围（最早 +5 分钟〔向上取整到分〕/ 最晚 +1 年）；在事件中调用，避免渲染期读 Date.now */
function computePublishBounds(): { min: string; max: string } {
  const now = Date.now();
  return {
    min: toLocalInput(ceilToMinute(now + SCHEDULE_MIN_AHEAD_MS)),
    max: toLocalInput(new Date(now + SCHEDULE_MAX_AHEAD_MS)),
  };
}

type Target = "public" | "guild";

export function ComposeScreen() {
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { push, replace, pop } = useNav();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [target, setTarget] = useState<Target>("public");
  const [targetTouched, setTargetTouched] = useState(false);
  const [pubCategory, setPubCategory] = useState(PUBLIC_CATEGORY_KEYS[0] || "general");
  const [guildCategory, setGuildCategory] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const publishingRef = useRef(false);
  const confirmTimerRef = useRef<number | null>(null);

  // 当前用户的会馆归属（/users/:id 同时下发 guild），再取其自定义分类
  const userId = user?.id || "";
  const profileQuery = useQuery({
    queryKey: ["compose-profile", userId],
    queryFn: () => api.user(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
  const guild = profileQuery.data?.guild as { uuid?: string; slug?: string; name?: string; theme_color?: string } | null | undefined;
  const guildSlug = guild?.slug || "";
  const guildQuery = useQuery({
    queryKey: ["compose-guild", guildSlug],
    queryFn: () => api.guild(guildSlug),
    enabled: !!guildSlug,
    staleTime: 5 * 60_000,
  });
  const guildCategories = useMemo<string[]>(() => {
    const list = guildQuery.data?.guild?.categories;
    if (!Array.isArray(list)) return [];
    return list.map((item: any) => String(item?.name || "")).filter(Boolean);
  }, [guildQuery.data]);

  // 首次拿到会馆信息：默认发到会馆（与 Web 一致），并补第一个分类
  useEffect(() => {
    if (!guild) return;
    if (!targetTouched) setTarget("guild");
  }, [guild, targetTouched]);

  useEffect(() => {
    if (guildCategories.length === 0) return;
    setGuildCategory((current) => (current && guildCategories.includes(current) ? current : guildCategories[0]));
  }, [guildCategories]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const dirty = title.trim().length > 0 || hasRichContent(content);
  const theme = guild?.theme_color || "";
  const categories = target === "guild" ? guildCategories : PUBLIC_CATEGORY_KEYS;
  const category = target === "guild" ? guildCategory : pubCategory;

  /* ------------------------------ 未登录 CTA ------------------------------ */
  if (!user) {
    return (
      <div className="screen">
        <div className="post-create-container">
          <div className="post-create-header">
            <button type="button" className="post-create-back" onClick={pop}>
              <i className="fa fa-angle-left" /> 返回
            </button>
            <h1 className="post-create-title">发布新帖子</h1>
            <div style={{ width: 60 }} />
          </div>
          <div className="post-create-form" style={{ textAlign: "center", padding: "36px 24px" }}>
            <i className="fa fa-user-circle-o" style={{ fontSize: 36, color: "var(--color-primary)" }} />
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "12px 0 6px" }}>登录后才能发帖</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "0 0 20px" }}>
              登录后可以发布帖子、插图、定时发布到会馆。
            </p>
            <div className="form-actions" style={{ justifyContent: "center", marginTop: 0 }}>
              <button type="button" className="btn-submit" onClick={() => push("auth")}>
                <i className="fa fa-sign-in" /> 去登录
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------ 交互 ------------------------------ */
  const toggleScheduled = (on: boolean) => {
    setScheduled(on);
    setBounds(on ? computePublishBounds() : null);
  };

  const cancel = () => {
    if (!dirty) {
      pop();
      return;
    }
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = window.setTimeout(() => setConfirmDiscard(false), 4000);
      return;
    }
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    pop();
  };

  const submit = async () => {
    if (publishingRef.current || busy) return;
    setError("");
    if (!title.trim()) return setError("请输入标题");
    if (!hasRichContent(content)) return setError("请输入内容");
    if (contentByteLength(content) > MAX_POST_CONTENT_BYTES) return setError("正文过长（上限 256KB）");
    if (target === "guild" && !guild?.uuid) return setError("会馆标识缺失，请刷新重试");

    // 定时发布：校验范围（本地时间 → UTC ISO，与服务端 RFC3339 口径一致）
    let publishedAt: string | undefined;
    if (scheduled) {
      if (!publishAt) return setError("请选择定时发布时间");
      const live = computePublishBounds();
      setBounds(live);
      const value = publishAt < live.min ? live.min : publishAt;
      if (value !== publishAt) setPublishAt(value);
      const time = new Date(value).getTime();
      if (!Number.isFinite(time)) return setError("定时发布时间无效");
      if (time > Date.now() + SCHEDULE_MAX_AHEAD_MS) return setError("定时发布时间不能超过 1 年");
      publishedAt = new Date(time).toISOString();
    }

    publishingRef.current = true;
    setBusy(true);
    try {
      const res = await api.createPost({
        title: title.trim(),
        content,
        category: category || undefined,
        guild_uuid: target === "guild" ? guild?.uuid : undefined,
        published_at: publishedAt,
      });
      showToast(scheduled ? "已设置定时发布" : "发布成功");
      replace("post", { id: res.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "发布失败");
    } finally {
      publishingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="post-create-container">
        {/* Web 发布页头：App 内吸顶并避开状态栏安全区（见页面 CSS） */}
        <div className="post-create-header">
          <button type="button" className="post-create-back" onClick={cancel}>
            <i className="fa fa-angle-left" /> 返回
          </button>
          <h1 className="post-create-title">发布新帖子</h1>
          <div style={{ width: 60 }} />
        </div>

        <div className="post-create-form">
          {/* 草稿条：Web 为自动保存草稿的状态条，App 内改为发布规则提示 */}
          <div className="post-draft-bar">
            <span className="post-draft-chip">
              <i className="fa fa-paper-plane" /> 发布
            </span>
            <div className="post-draft-status-wrap" role="status">
              <span className="post-draft-status is-idle">
                <i className="fa fa-cloud" /> 发布后所有访客可见；插图请用编辑器工具条上的图片按钮
              </span>
            </div>
          </div>

          {/* 发布到 */}
          <div className="form-group">
            <label className="form-label">发布到</label>
            <div className="post-target-segmented">
              <button
                type="button"
                className={`post-target-btn ${target === "public" ? "active" : ""}`}
                onClick={() => {
                  setTarget("public");
                  setTargetTouched(true);
                }}
              >
                <i className="fa fa-globe" /> 公共空间
              </button>
              {guild ? (
                <button
                  type="button"
                  className={`post-target-btn ${target === "guild" ? "active" : ""}`}
                  style={
                    target === "guild"
                      ? ({ background: theme || "var(--color-primary)", borderColor: theme || "var(--color-primary)", color: contrastText(theme || "#6A8C89") } as React.CSSProperties)
                      : undefined
                  }
                  onClick={() => {
                    setTarget("guild");
                    setTargetTouched(true);
                  }}
                >
                  <i className="fa fa-home" /> 我的会馆（{guild.name}）
                </button>
              ) : null}
            </div>
            {target === "guild" && guild ? (
              <p className="post-target-hint">
                <i className="fa fa-info-circle" /> 帖子将发布到会馆「{guild.name}」，所有访客可见
              </p>
            ) : null}
            {profileQuery.isError ? (
              <p className="post-target-hint post-target-hint-warn">
                <i className="fa fa-exclamation-circle" /> 会馆信息加载失败，当前按公共空间发布；请刷新重试
              </p>
            ) : null}
          </div>

          {/* 分类（会馆无自定义分类时隐藏，对齐 Web） */}
          {categories.length > 0 ? (
            <div className="form-group">
              <label className="form-label">帖子分类</label>
              <div className="form-category-select" id="form-category-select">
                {categories.map((key) => {
                  const label = target === "guild" ? key : CATEGORY_LABELS[key] || key;
                  const active = category === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`category-chip ${active ? "active" : ""}`}
                      data-value={key}
                      style={
                        active && target === "guild"
                          ? ({ background: theme || "var(--color-primary)", color: contrastText(theme || "#6A8C89") } as React.CSSProperties)
                          : undefined
                      }
                      onClick={() => {
                        if (target === "guild") setGuildCategory(key);
                        else setPubCategory(key);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="form-group">
            <label className="form-label">帖子标题</label>
            <input
              type="text"
              className="form-input"
              id="post-title-input"
              placeholder="请输入标题..."
              maxLength={100}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <div className="form-hint" style={{ textAlign: "right" }}>
              {title.length} / 100
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">帖子内容</label>
            <RichEditor value={content} onChange={setContent} placeholder="在此输入正文…" minHeight={240} scene="post_image" />
          </div>

          {/* 定时发布（可选） */}
          <div className="form-group">
            <label className="post-schedule-toggle">
              <input type="checkbox" checked={scheduled} onChange={(event) => toggleScheduled(event.target.checked)} />
              <i className="fa fa-clock-o" /> 定时发布
            </label>
            {scheduled ? (
              <>
                <input
                  type="datetime-local"
                  className="form-input"
                  style={{ marginTop: 10 }}
                  value={publishAt}
                  min={bounds?.min}
                  max={bounds?.max}
                  onChange={(event) => setPublishAt(event.target.value)}
                />
                <p className="post-schedule-hint">
                  <i className="fa fa-info-circle" /> 到点后自动发布：最早为当前时间 5 分钟后，最晚 1 年内；未到时间前仅自己可见。
                </p>
              </>
            ) : null}
          </div>

          {error ? <p style={{ color: "#ef4444", margin: "12px 0 0" }}>{error}</p> : null}

          {/* 底部操作（对齐 Web .form-actions） */}
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={cancel}>
              {confirmDiscard ? "确定放弃？" : "取消"}
            </button>
            <button
              type="button"
              className="btn-submit"
              id="post-submit-btn"
              disabled={busy}
              onClick={() => void submit()}
              style={target === "guild" && theme ? { background: theme, color: contrastText(theme) } : undefined}
            >
              <i className="fa fa-paper-plane" /> {busy ? "发布中..." : scheduled ? "定时发布" : "发布"}
            </button>
          </div>

          {/* 发帖须知（默认收起） */}
          <div className={`post-compliance-collapse ${noticeOpen ? "open" : ""}`}>
            <button type="button" className="post-compliance-toggle" onClick={() => setNoticeOpen((open) => !open)} aria-expanded={noticeOpen}>
              <i className="fa fa-shield" />
              <span>发帖须知</span>
              <i className={`fa ${noticeOpen ? "fa-chevron-up" : "fa-chevron-down"} post-compliance-arrow`} />
            </button>
            {noticeOpen ? (
              <ul className="post-compliance-list">
                {COMPLIANCE.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
