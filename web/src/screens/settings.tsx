import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PRIVACY_VERSION, useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { Confirm, TopBar } from "../components/ui";
import { formatDate } from "../lib/format";
import type { Theme } from "../lib/types";
import "../styles/character-settings-page.css";

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: string; desc: string }> = [
  { value: "day", label: "日间", icon: "fa-sun-o", desc: "明亮的浅色界面，白天看得清。" },
  { value: "night", label: "夜间", icon: "fa-moon-o", desc: "深色界面，弱光环境下更舒服。" },
  { value: "auto", label: "跟随系统", icon: "fa-adjust", desc: "随手机的深色模式自动切换。" },
];

const YEAR_OPTIONS: Array<{ value: "wuxian" | "ce"; label: string; icon: string; desc: string }> = [
  { value: "wuxian", label: "无限年", icon: "fa-magic", desc: "论坛通用纪年，无限元年 = 公元 1604 年。" },
  { value: "ce", label: "公元年", icon: "fa-globe", desc: "直接显示现实中的公历年份。" },
];

/** 键值行：Web 账号页没有对应类，排版见 character-settings-page.css */
function InfoRow({ label, value, onClick }: { label: string; value?: React.ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span>{label}</span>
      {value === undefined || value === null || value === "" ? null : (
        <span className="settings-info-value">{value}</span>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className="settings-info-row settings-info-action" onClick={onClick}>{body}</button>
  ) : (
    <div className="settings-info-row">{body}</div>
  );
}

export function SettingsScreen() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const yearMode = useApp((s) => s.yearMode);
  const setYearMode = useApp((s) => s.setYearMode);
  const user = useApp((s) => s.user);
  const consented = useApp((s) => s.consented);
  const appInfo = useApp((s) => s.appInfo);
  const showToast = useApp((s) => s.showToast);
  const logout = useApp((s) => s.logout);
  const { push } = useNav();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const quote = useQuery({
    queryKey: ["daily-quote"],
    queryFn: () => api.dailyQuote(),
    staleTime: 10 * 60_000,
    retry: 0,
    enabled: consented,
  });

  const revealEasterEgg = async () => {
    try {
      const res = await api.easterEgg();
      const name = res?.Name || res?.name || "";
      const text = res?.Text || res?.text || "";
      showToast(text ? `${name ? `${name}：` : ""}${text}` : "彩蛋被你发现了");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "彩蛋不存在", "error");
    }
  };

  return (
    <div className="screen">
      <TopBar title="设置" back />

      <div className="account-page">
        <div className="settings-stack">
          <div className="account-card">
            <div className="account-page-header">
              <h1><i className="fa fa-sliders" aria-hidden="true"></i> 设置</h1>
              <p>外观、年制与隐私都由你决定，改动会立即生效。</p>
            </div>

            <section className="settings-block">
              <h3 className="settings-block-title">外观主题</h3>
              <div className="account-mode-list">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`account-mode-card${theme === option.value ? " selected" : ""}`}
                    aria-pressed={theme === option.value}
                    onClick={() => setTheme(option.value)}
                  >
                    <div className="account-mode-head">
                      <span className="account-mode-radio" aria-hidden="true"></span>
                      <h3><i className={`fa ${option.icon}`} aria-hidden="true"></i> {option.label}</h3>
                    </div>
                    <p className="account-mode-desc">{option.desc}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-block">
              <h3 className="settings-block-title">年制偏好</h3>
              <div className="account-mode-list">
                {YEAR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`account-mode-card${yearMode === option.value ? " selected" : ""}`}
                    aria-pressed={yearMode === option.value}
                    onClick={() => setYearMode(option.value)}
                  >
                    <div className="account-mode-head">
                      <span className="account-mode-radio" aria-hidden="true"></span>
                      <h3><i className={`fa ${option.icon}`} aria-hidden="true"></i> {option.label}</h3>
                    </div>
                    <p className="account-mode-desc">{option.desc}</p>
                  </button>
                ))}
              </div>
              <p className="settings-block-hint">
                无限元年 = 公元 1604 年。
                <button type="button" className="account-settings-btn" onClick={() => push("year")}>
                  <i className="fa fa-exchange" aria-hidden="true"></i> 打开年制换算
                </button>
              </p>
            </section>
          </div>

          <div className="privacy-section">
            <h3>
              <span className="section-icon"><i className="fa fa-shield" aria-hidden="true"></i></span> 隐私说明
            </h3>
            <p className="privacy-intro">
              只收集必要的信息：账号信息（用户名、邮箱）、你主动发布的内容（帖子、评论、角色设定、反馈），以及保障安全与排障所需的请求日志。
            </p>
            <ul className="privacy-list">
              <li>不读取通讯录，只有你主动选图时才会访问相册。</li>
              <li>密码只保存加盐哈希，我们不会也无法看到你的原密码。</li>
              <li>请求日志只用于安全与排障，并按期限滚动清理。</li>
            </ul>
            <span className="privacy-updated">
              <i className="fa fa-clock-o" aria-hidden="true"></i> 隐私政策版本 {PRIVACY_VERSION}
            </span>
          </div>

          <div className="privacy-section">
            <h3>
              <span className="section-icon"><i className="fa fa-mobile" aria-hidden="true"></i></span> 人机验证与零 PoW
            </h3>
            <p className="privacy-intro">
              APP 使用专属验证通道（/captcha/app/*），一次签名换一张短期凭据，只在登录、注册、评论与反馈时校验；手机不再执行工作量证明，不会因求解而发烫或卡死。该密钥可随时在服务端撤销。
            </p>
          </div>

          <div className="account-card">
            <h3 className="settings-card-title"><i className="fa fa-info-circle" aria-hidden="true"></i> 关于</h3>
            <div className="settings-info-list">
              <InfoRow label="版本号" value={`${appInfo?.versionName || "2.0.0"}（${appInfo?.versionCode ?? 20000}）`} />
              <InfoRow label="包名" value={appInfo?.packageName || "—"} />
              <InfoRow label="API 地址" value={appInfo?.apiBaseUrl || "—"} />
              <InfoRow label="彩蛋" value="点一下 ›" onClick={() => void revealEasterEgg()} />
            </div>
          </div>

          <div className="account-card">
            <h3 className="settings-card-title"><i className="fa fa-user-circle-o" aria-hidden="true"></i> 登录状态</h3>
            <p className="privacy-intro" style={{ marginBottom: 16 }}>
              {user ? `当前登录：${user.name}` : "当前未登录，登录后可以发帖、评论与查看角色设定。"}
            </p>
            {user ? (
              <button type="button" className="account-btn-danger account-submit-btn" onClick={() => setConfirmLogout(true)}>退出登录</button>
            ) : (
              <button type="button" className="auth-btn primary" onClick={() => push("auth")}>登录 / 注册</button>
            )}
          </div>
        </div>

        <div className="privacy-footer">
          <p>
            {quote.data?.text ? `${quote.data.text}${quote.data.source ? ` —— ${quote.data.source}` : ""}` : "妖精论坛（二创） · 非商业同人项目"}
          </p>
        </div>
      </div>

      <Confirm
        open={confirmLogout}
        title="退出登录？"
        confirmText="退出"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => { setConfirmLogout(false); await logout(); showToast("已退出登录"); }}
      >
        退出后需要重新登录才能发帖与评论。
      </Confirm>
    </div>
  );
}

export function AccountScreen() {
  const user = useApp((s) => s.user);
  const appInfo = useApp((s) => s.appInfo);
  const showToast = useApp((s) => s.showToast);
  const logout = useApp((s) => s.logout);
  const { push, pop } = useNav();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);

  if (!user) {
    return (
      <div className="screen">
        <TopBar title="账号安全" back />
        <div className="account-page">
          <div className="account-card">
            <div className="account-page-header">
              <h1><i className="fa fa-shield" aria-hidden="true"></i> 账号安全</h1>
              <p>登录后可以查看账号信息、修改密码。</p>
            </div>
            <button type="button" className="auth-btn primary" onClick={() => push("auth")}>登录 / 注册</button>
          </div>
        </div>
      </div>
    );
  }

  const verified = Boolean(user.email_verified);

  const changePassword = async () => {
    setError("");
    if (!current) return setError("请输入当前密码");
    if (next.length < 8) return setError("新密码至少 8 位");
    if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) return setError("新密码需同时包含字母和数字");
    if (next !== repeat) return setError("两次输入的新密码不一致");
    if (next === current) return setError("新密码不能与当前密码相同");
    setBusy(true);
    try {
      await api.updateMe({ current_password: current, password: next });
      setCurrent("");
      setNext("");
      setRepeat("");
      showToast("密码已更新，其他设备需重新登录");
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <TopBar title="账号安全" back />

      <div className="account-page">
        <div className="settings-stack">
          <div className="account-card">
            <div className="account-page-header">
              <h1><i className="fa fa-shield" aria-hidden="true"></i> 账号安全</h1>
              <p>账号资料、登录密码与注销说明。</p>
            </div>
            <div className="settings-info-list">
              <InfoRow label="用户名" value={user.name} />
              <InfoRow label="邮箱" value={user.email || "未绑定"} />
              <InfoRow
                label="邮箱验证"
                value={<span style={{ color: verified ? "var(--color-secondary)" : "#e6803d" }}>{verified ? "已验证" : "未验证"}</span>}
              />
              {user.created_at ? <InfoRow label="注册时间" value={formatDate(user.created_at)} /> : null}
            </div>
          </div>

          <div className="account-card">
            <h3 className="settings-card-title"><i className="fa fa-lock" aria-hidden="true"></i> 修改密码</h3>
            <div className="account-field">
              <label htmlFor="account-current-password">当前密码</label>
              <input
                id="account-current-password"
                type="password"
                autoComplete="current-password"
                placeholder="用于确认是你本人"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </div>
            <div className="account-field">
              <label htmlFor="account-new-password">新密码</label>
              <input
                id="account-new-password"
                type="password"
                autoComplete="new-password"
                placeholder="至少 8 位，含字母与数字"
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            </div>
            <div className="account-field">
              <label htmlFor="account-repeat-password">确认新密码</label>
              <input
                id="account-repeat-password"
                type="password"
                autoComplete="new-password"
                placeholder="再输一遍新密码"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
              />
            </div>
            {error ? <p className="account-field-hint">{error}</p> : null}
            <button type="button" className="auth-btn primary" disabled={busy} onClick={() => void changePassword()}>
              {busy ? "提交中…" : "更新密码"}
            </button>
            <p className="settings-block-hint">修改成功后其他设备上的登录会自动失效，当前设备保持登录。</p>
          </div>

          <div className="account-card">
            <h3 className="settings-card-title"><i className="fa fa-user-times" aria-hidden="true"></i> 注销账号</h3>
            <div className="account-warn-bar" style={{ marginBottom: 16 }}>
              <i className="fa fa-exclamation-triangle" aria-hidden="true"></i> 注销后无法恢复，请谨慎操作。
            </div>
            <p className="privacy-intro">
              注销会同时删除帖子、评论、角色设定与关注关系，且不可恢复。为避免误操作，APP 内不提供一键注销：请在浏览器打开论坛网站，登录后进入「账号设置 → 注销账号」按提示确认。
            </p>
            {!verified ? (
              <p className="account-field-hint" style={{ margin: "10px 0 0" }}>注销前建议先完成邮箱验证，以便找回账号。</p>
            ) : null}
            <p className="settings-block-hint">{appInfo?.apiBaseUrl ? `当前服务：${appInfo.apiBaseUrl}` : "当前服务：妖精论坛"}</p>
          </div>

          <button type="button" className="account-btn-danger account-submit-btn" onClick={() => setConfirmLogout(true)}>退出登录</button>
        </div>

        <div className="privacy-footer">
          <p>密码只保存加盐哈希，我们不会也无法看到你的原密码。</p>
        </div>
      </div>

      <Confirm
        open={confirmLogout}
        title="退出登录？"
        confirmText="退出"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => { setConfirmLogout(false); await logout(); showToast("已退出登录"); pop(); }}
      >
        退出后需要重新登录才能发帖与评论。
      </Confirm>
    </div>
  );
}
