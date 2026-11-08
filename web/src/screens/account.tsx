import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { clearCaptcha } from "../lib/native";
import { AppBar, Confirm, Empty, Loader, Screen, Skeletons } from "../components/mobile";
import { Icon } from "../components/icons";
import { categoryLabel, formatDate, timeAgo } from "../lib/format";
import type { AccountDeleteMode, EmailChangeStage, PostDraftItem } from "../lib/types";

/** 帖子草稿的本机 key（发帖页旧版只存在设备上） */
const LOCAL_DRAFT_KEY = "yj.compose.draft.v1";
const LOCAL_DRAFT_MIGRATED_KEY = "yj.compose.draft.migrated.v1";
/** 换绑第一阶段已完成（旧邮箱已验证）的会话内标记，与服务端 stage=2 的 30 分钟窗口对齐 */
const OLD_DONE_KEY = "yj.email-change.old-done";
const OLD_DONE_TTL = 30 * 60 * 1000;

function readOldDone(): boolean {
  try {
    const raw = sessionStorage.getItem(OLD_DONE_KEY);
    if (!raw) return false;
    return Number(raw) > Date.now();
  } catch {
    return false;
  }
}

function writeOldDone() {
  try {
    sessionStorage.setItem(OLD_DONE_KEY, String(Date.now() + OLD_DONE_TTL));
  } catch {
    /* 无 sessionStorage 时仅当前页面生命周期有效 */
  }
}

function clearOldDone() {
  try {
    sessionStorage.removeItem(OLD_DONE_KEY);
  } catch {
    /* 忽略 */
  }
}

function errorOf(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/** 验证码输入：只保留数字，最多 6 位 */
function codeOf(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/* ============================== 邮箱 ============================== */

/** 邮箱验证 / 换绑（stage 用于恢复流程阶段） */
export function EmailScreen({ stage }: { stage?: EmailChangeStage }) {
  const user = useApp((s) => s.user);
  const refreshUser = useApp((s) => s.refreshUser);
  const showToast = useApp((s) => s.showToast);
  const { push, pop } = useNav();

  const verified = Boolean(user?.email_verified);
  const email = user?.email || "";

  // 换绑两步；stage=old-verified/new-sent 或本会话已完成第一步时直接从「新邮箱」开始
  const [step, setStep] = useState<1 | 2>(() => (stage === "old-verified" || stage === "new-sent" || readOldDone() ? 2 : 1));
  const [done, setDone] = useState(() => stage === "done");
  const [oldDone, setOldDone] = useState(() => readOldDone());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 未验证：发码 + 6 位输入
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyCountdown, setVerifyCountdown] = useState(0);

  // 换绑：旧邮箱 / 新邮箱
  const [oldCode, setOldCode] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newCode, setNewCode] = useState("");
  const [oldCountdown, setOldCountdown] = useState(0);
  const [newCountdown, setNewCountdown] = useState(0);

  // 60 秒重发倒计时
  useEffect(() => {
    if (verifyCountdown <= 0) return;
    const timer = window.setTimeout(() => setVerifyCountdown((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [verifyCountdown]);
  useEffect(() => {
    if (oldCountdown <= 0) return;
    const timer = window.setTimeout(() => setOldCountdown((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [oldCountdown]);
  useEffect(() => {
    if (newCountdown <= 0) return;
    const timer = window.setTimeout(() => setNewCountdown((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [newCountdown]);

  const sendVerifyCode = async () => {
    if (busy || verifyCountdown > 0) return;
    setBusy(true);
    setError("");
    try {
      await api.verifyEmail();
      setVerifyCountdown(60);
      showToast("验证码已发送至当前邮箱");
    } catch (reason) {
      setError(errorOf(reason, "发送失败"));
    } finally {
      setBusy(false);
    }
  };

  const confirmVerify = async () => {
    if (busy) return;
    const code = codeOf(verifyCode);
    if (code.length !== 6) return setError("请输入 6 位验证码");
    setBusy(true);
    setError("");
    try {
      await api.confirmVerifyEmail(code);
      await refreshUser();
      setDone(true);
      showToast("邮箱验证成功");
    } catch (reason) {
      setError(errorOf(reason, "验证失败"));
    } finally {
      setBusy(false);
    }
  };

  const sendOldCode = async () => {
    if (busy || oldCountdown > 0) return;
    setBusy(true);
    setError("");
    try {
      await api.emailChangeCode();
      setOldCountdown(60);
      showToast("验证码已发送至当前邮箱");
    } catch (reason) {
      setError(errorOf(reason, "发送失败"));
    } finally {
      setBusy(false);
    }
  };

  const verifyOld = async () => {
    if (busy) return;
    const code = codeOf(oldCode);
    if (code.length !== 6) return setError("请输入 6 位验证码");
    setBusy(true);
    setError("");
    try {
      await api.verifyOldEmail(code);
      writeOldDone();
      setOldDone(true);
      setStep(2);
      showToast("当前邮箱验证通过");
    } catch (reason) {
      setError(errorOf(reason, "验证失败"));
    } finally {
      setBusy(false);
    }
  };

  const sendNewCode = async () => {
    if (busy || newCountdown > 0) return;
    const target = newEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) return setError("请输入有效的新邮箱");
    if (target.toLowerCase() === email.toLowerCase()) return setError("新邮箱与当前邮箱相同");
    setBusy(true);
    setError("");
    try {
      await api.emailChangeNewCode(target);
      setNewCountdown(60);
      showToast("验证码已发送至新邮箱");
    } catch (reason) {
      setError(errorOf(reason, "发送失败"));
    } finally {
      setBusy(false);
    }
  };

  const confirmNew = async () => {
    if (busy) return;
    const code = codeOf(newCode);
    if (code.length !== 6) return setError("请输入 6 位验证码");
    setBusy(true);
    setError("");
    try {
      await api.confirmEmailChange(code);
      clearOldDone();
      setOldDone(false);
      await refreshUser();
      setDone(true);
      showToast("邮箱换绑成功");
    } catch (reason) {
      setError(errorOf(reason, "换绑失败"));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    clearOldDone();
    setOldDone(false);
    setStep(1);
    setOldCode("");
    setNewEmail("");
    setNewCode("");
    setError("");
  };

  if (!user) {
    return (
      <Screen appbar={<AppBar back title="邮箱" />}>
        <Empty
          icon="mail"
          title="请先登录"
          hint="登录后可以验证邮箱或更换绑定邮箱"
          action={<button className="m-btn m-btn--primary" onClick={() => push("auth")}>登录 / 注册</button>}
        />
      </Screen>
    );
  }

  /* 完成态 */
  if (done) {
    return (
      <Screen appbar={<AppBar back title="邮箱" />}>
        <div className="em-card">
          <div className="em-done">
            <span className="em-done-mark"><Icon name="check" size={26} /></span>
            <div className="em-card-title">邮箱已就绪</div>
            <div className="em-note"><b>{email || "已绑定"}</b> 已验证，可用于找回密码与接收账号通知。</div>
          </div>
          <button type="button" className="m-btn m-btn--primary m-btn--block" onClick={pop}>返回</button>
        </div>
      </Screen>
    );
  }

  /* 未验证：直接进入验证流程 */
  if (!verified) {
    return (
      <Screen appbar={<AppBar back title="验证邮箱" />}>
        <div className="em-card">
          <div className="em-card-title">验证当前邮箱</div>
          <p className="em-note">
            {email ? <>当前邮箱 <b>{email}</b> 尚未验证。</> : "账号还没有绑定邮箱，请先在网页端绑定后再验证。"}
            {" "}验证后可以找回密码，并接收邮箱换绑通知。
          </p>
          <div className="em-field">
            <label className="m-label" htmlFor="em-verify-code">验证码</label>
            <div className="em-code">
              <input
                id="em-verify-code"
                className="m-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="6 位数字"
                value={verifyCode}
                onChange={(event) => {
                  setVerifyCode(codeOf(event.target.value));
                  if (error) setError("");
                }}
              />
              <button
                type="button"
                className="m-btn m-btn--soft"
                disabled={busy || verifyCountdown > 0 || !email}
                onClick={() => void sendVerifyCode()}
              >
                {verifyCountdown > 0 ? `${verifyCountdown}s` : busy ? "发送中…" : "发送验证码"}
              </button>
            </div>
            <p className="em-hint">验证码 5 分钟内有效；同一邮箱 60 秒内只能发送一次。</p>
          </div>
          {error ? <p className="em-error" role="alert"><Icon name="alert" size={14} />{error}</p> : null}
          <button type="button" className="m-btn m-btn--primary m-btn--block" disabled={busy} onClick={() => void confirmVerify()}>
            {busy ? "提交中…" : "提交验证"}
          </button>
        </div>
      </Screen>
    );
  }

  /* 已验证：两步换绑 */
  return (
    <Screen appbar={<AppBar back title="更换邮箱" />}>
      <div className="em-steps" aria-hidden="true">
        <span className={`em-step ${step >= 1 ? "on" : ""}`.trim()} />
        <span className={`em-step ${step >= 2 ? "on" : ""}`.trim()} />
      </div>

      <div className="em-card">
        <div className="em-card-title">{step === 1 ? "① 验证当前邮箱" : "② 绑定新邮箱"}</div>
        <p className="em-note">
          {step === 1 ? (
            <>当前邮箱 <b>{email || "未绑定"}</b>。为了保护账号安全，换绑前需要先验证当前邮箱；验证通过后 30 分钟内可继续绑定新邮箱。</>
          ) : (
            <>当前邮箱 <b>{email || "未绑定"}</b> 已通过验证。请输入要绑定的新邮箱，我们会向新邮箱再发一次验证码。</>
          )}
        </p>

        {step === 1 ? (
          <div className="em-field">
            <label className="m-label" htmlFor="em-old-code">验证码</label>
            <div className="em-code">
              <input
                id="em-old-code"
                className="m-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="6 位数字"
                value={oldCode}
                onChange={(event) => {
                  setOldCode(codeOf(event.target.value));
                  if (error) setError("");
                }}
              />
              <button
                type="button"
                className="m-btn m-btn--soft"
                disabled={busy || oldCountdown > 0 || !email}
                onClick={() => void sendOldCode()}
              >
                {oldCountdown > 0 ? `${oldCountdown}s` : busy ? "发送中…" : "发送验证码"}
              </button>
            </div>
            <p className="em-hint">验证码会发到当前邮箱，1 小时内最多发送一次。</p>
          </div>
        ) : (
          <>
            <div className="em-field">
              <label className="m-label" htmlFor="em-new-email">新邮箱</label>
              <input
                id="em-new-email"
                className="m-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={newEmail}
                onChange={(event) => {
                  setNewEmail(event.target.value);
                  if (error) setError("");
                }}
              />
            </div>
            <div className="em-field">
              <label className="m-label" htmlFor="em-new-code">新邮箱验证码</label>
              <div className="em-code">
                <input
                  id="em-new-code"
                  className="m-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="6 位数字"
                  value={newCode}
                  onChange={(event) => {
                    setNewCode(codeOf(event.target.value));
                    if (error) setError("");
                  }}
                />
                <button
                  type="button"
                  className="m-btn m-btn--soft"
                  disabled={busy || newCountdown > 0}
                  onClick={() => void sendNewCode()}
                >
                  {newCountdown > 0 ? `${newCountdown}s` : busy ? "发送中…" : "发送验证码"}
                </button>
              </div>
              <p className="em-hint">同一新邮箱 10 分钟内最多发送 3 次，两次至少间隔 60 秒。</p>
            </div>
          </>
        )}

        {error ? <p className="em-error" role="alert"><Icon name="alert" size={14} />{error}</p> : null}

        {step === 1 ? (
          <>
            <button type="button" className="m-btn m-btn--primary m-btn--block" disabled={busy} onClick={() => void verifyOld()}>
              {busy ? "验证中…" : "验证当前邮箱"}
            </button>
            {oldDone ? (
              <button type="button" className="m-btn m-btn--ghost m-btn--block" onClick={() => setStep(2)}>
                已通过验证，继续绑定新邮箱
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button type="button" className="m-btn m-btn--primary m-btn--block" disabled={busy} onClick={() => void confirmNew()}>
              {busy ? "提交中…" : "完成换绑"}
            </button>
            <button type="button" className="m-btn m-btn--ghost m-btn--block" disabled={busy} onClick={restart}>
              重新验证当前邮箱
            </button>
          </>
        )}
      </div>

      <p className="em-hint em-hint--foot">换绑成功后旧邮箱会收到通知；新邮箱验证通过前，换绑不会生效。</p>
    </Screen>
  );
}

/* ============================== 注销 ============================== */

const DELETE_MODES: Array<{ key: AccountDeleteMode; label: string; desc: string }> = [
  {
    key: "anonymize",
    label: "注销并保留内容（推荐）",
    desc: "账号变「已注销用户」，头像与昵称匿名化；帖子、评论与角色设定继续存在，但不再关联你。无法再登录。",
  },
  {
    key: "purge",
    label: "彻底删除账号与内容",
    desc: "账号以及你的全部帖子、评论、角色设定、关注关系都会被删除，他人也将无法再看到，无法恢复。",
  },
];

/** 注销账号（purge / anonymize） */
export function AccountDeleteScreen() {
  const user = useApp((s) => s.user);
  const logout = useApp((s) => s.logout);
  const showToast = useApp((s) => s.showToast);
  const { push, reset } = useNav();

  const [mode, setMode] = useState<AccountDeleteMode>("anonymize");
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const request = () => {
    if (busy) return;
    setError("");
    if (!password) return setError("请输入密码");
    if (!confirmName.trim()) return setError("请输入当前昵称以确认");
    if (confirmName.trim() !== (user?.name || "")) return setError("输入的昵称与当前昵称不一致");
    setConfirmOpen(true);
  };

  const remove = async () => {
    if (busy || !user) return;
    setConfirmOpen(false);
    setBusy(true);
    setError("");
    try {
      await api.deleteAccount(mode, password, confirmName.trim());
      // 账号已注销：清掉验证凭证与本地草稿缓存，再退登录并回到登录页
      await clearCaptcha().catch(() => undefined);
      try {
        localStorage.removeItem(LOCAL_DRAFT_KEY);
        localStorage.removeItem(LOCAL_DRAFT_MIGRATED_KEY);
      } catch {
        /* 存储不可用时忽略 */
      }
      clearOldDone();
      await logout();
      showToast("账号已注销");
      reset("feed");
      push("auth");
    } catch (reason) {
      setError(errorOf(reason, "注销失败"));
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <Screen appbar={<AppBar back title="注销账号" />}>
        <Empty
          icon="shield"
          title="请先登录"
          hint="登录后才能注销账号"
          action={<button className="m-btn m-btn--primary" onClick={() => push("auth")}>登录 / 注册</button>}
        />
      </Screen>
    );
  }

  return (
    <>
      <Screen appbar={<AppBar back title="注销账号" />}>
        <div className="ad-warn">
          <strong>注销不可撤销</strong>
          注销后账号立即失效，所有设备上的登录状态都会被清除，且无法恢复。建议先确认没有未发布的草稿或需要保留的内容。
        </div>

        <div className="ad-modes" role="radiogroup" aria-label="注销方式">
          {DELETE_MODES.map((item) => {
            const active = item.key === mode;
            return (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={active}
                className={`ad-mode ${active ? "on" : ""}`.trim()}
                onClick={() => setMode(item.key)}
              >
                <span className="ad-mode-dot" aria-hidden="true">{active ? <Icon name="check" size={12} /> : null}</span>
                <span className="ad-mode-text">
                  <strong>{item.label}</strong>
                  <span>{item.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="ad-card">
          <div className="em-field">
            <label className="m-label" htmlFor="ad-password">密码</label>
            <input
              id="ad-password"
              className="m-input"
              type="password"
              autoComplete="current-password"
              placeholder="用于确认是你本人"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError("");
              }}
            />
          </div>
          <div className="em-field">
            <label className="m-label" htmlFor="ad-name">输入当前昵称确认</label>
            <input
              id="ad-name"
              className="m-input"
              type="text"
              autoComplete="off"
              placeholder={user.name}
              value={confirmName}
              onChange={(event) => {
                setConfirmName(event.target.value);
                if (error) setError("");
              }}
            />
            <p className="em-hint">需与当前昵称「{user.name}」完全一致。</p>
          </div>
          {error ? <p className="ad-error" role="alert"><Icon name="alert" size={14} />{error}</p> : null}
        </div>

        <div className="ad-actions">
          <button type="button" className="m-btn m-btn--danger m-btn--block" disabled={busy} onClick={request}>
            {busy ? "注销中…" : "注销账号"}
          </button>
        </div>

        <p className="st-footnote">
          <span className="m-small m-muted">密码只保存加盐哈希，我们不会也无法看到你的原密码；忘记密码请先在网页端找回后再注销。</span>
        </p>
      </Screen>

      <Confirm
        open={confirmOpen}
        title={mode === "purge" ? "彻底删除账号？" : "注销并保留内容？"}
        confirmText="确认注销"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void remove()}
      >
        {mode === "purge"
          ? "账号与全部内容（帖子、评论、角色设定、关注关系）将被永久删除，无法恢复。"
          : "账号将变为「已注销用户」，帖子与评论保留但不再关联你，且无法再登录恢复。"}
      </Confirm>
    </>
  );
}

/* ============================== 草稿箱 ============================== */

/** 帖子草稿箱（带 id = 直接打开某份草稿） */
export function DraftsScreen({ id }: { id?: string }) {
  const showToast = useApp((s) => s.showToast);
  const { push, replace } = useNav();
  const [pendingDelete, setPendingDelete] = useState<PostDraftItem | null>(null);
  const [removing, setRemoving] = useState(false);

  const query = useQuery({
    queryKey: ["post-drafts"],
    queryFn: () => api.listDrafts(50),
    // 带 id 进入时只做跳转，不必拉列表
    enabled: !id,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // 带 id 进入：直接跳到对应草稿编辑（替换本页，返回时不回到草稿箱中间态）
  useEffect(() => {
    if (id) replace("compose", { draft: id });
  }, [id, replace]);

  if (id) {
    return (
      <Screen appbar={<AppBar back title="草稿箱" />}>
        <Loader text="正在打开草稿…" />
      </Screen>
    );
  }

  const drafts = query.data?.drafts || [];

  const remove = async () => {
    if (!pendingDelete || removing) return;
    setRemoving(true);
    try {
      await api.deleteDraft(pendingDelete.id);
      setPendingDelete(null);
      showToast("草稿已删除");
      await query.refetch();
    } catch (reason) {
      showToast(errorOf(reason, "删除失败"), "error");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Screen
        appbar={<AppBar back title="草稿箱" />}
        footer={
          <div className="dr-foot">
            <button type="button" className="m-btn m-btn--primary m-btn--block" onClick={() => push("compose")}>
              写新帖子
            </button>
          </div>
        }
      >
        {query.isLoading ? (
          <Skeletons count={3} />
        ) : query.isError ? (
          <Empty
            icon="alert"
            title="草稿加载失败"
            hint={errorOf(query.error, "请稍后重试")}
            action={<button className="m-btn m-btn--primary" onClick={() => void query.refetch()}>重试</button>}
          />
        ) : drafts.length === 0 ? (
          <Empty icon="edit" title="还没有草稿" hint="发帖页编辑的内容会自动保存到这里，未发布前只有你能看到。" />
        ) : (
          <>
            <div className="dr-list">
              {drafts.map((draft) => {
                const title = (draft.title || "").trim();
                const summary = (draft.summary || "").trim();
                return (
                  <div key={draft.id} className="dr-item">
                    <button type="button" className="dr-main" onClick={() => push("compose", { draft: draft.id })}>
                      <span className={`dr-title ${title ? "" : "dr-title--empty"}`.trim()}>{title || "未命名草稿"}</span>
                      {summary ? <span className="dr-summary">{summary}</span> : null}
                      <span className="dr-meta">
                        <span>{timeAgo(draft.updated_at || draft.created_at) || "刚刚"}</span>
                        {draft.category ? <span>· {categoryLabel(draft.category)}</span> : null}
                        {draft.guild_name ? <span>· {draft.guild_name}</span> : null}
                        {draft.scheduled_at ? (
                          <>
                            <span className="dr-tag">定时</span>
                            <span>{formatDate(draft.scheduled_at)}</span>
                          </>
                        ) : null}
                      </span>
                    </button>
                    <div className="dr-actions">
                      <button
                        type="button"
                        className="dr-del"
                        aria-label={`删除草稿 ${title || "未命名"}`}
                        onClick={() => setPendingDelete(draft)}
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="dr-end">— 共 {drafts.length} 份草稿 —</div>
          </>
        )}
      </Screen>

      <Confirm
        open={Boolean(pendingDelete)}
        title="删除这份草稿？"
        confirmText="删除"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      >
        「{(pendingDelete?.title || "未命名草稿").trim() || "未命名草稿"}」删除后无法恢复。
      </Confirm>
    </>
  );
}
