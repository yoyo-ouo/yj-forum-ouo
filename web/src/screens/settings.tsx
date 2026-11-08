import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PRIVACY_VERSION, useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { Confirm, TopBar } from "../components/ui";
import { formatDate } from "../lib/format";
import type { Theme } from "../lib/types";

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: "day", label: "日间" },
  { value: "night", label: "夜间" },
  { value: "auto", label: "跟随系统" },
];

const YEAR_OPTIONS: Array<{ value: "wuxian" | "ce"; label: string }> = [
  { value: "wuxian", label: "无限年" },
  { value: "ce", label: "公元年" },
];

function InfoRow({ label, value, onClick }: { label: string; value?: React.ReactNode; onClick?: () => void }) {
  return (
    <div className="me-cell" onClick={onClick}>
      <span>{label}</span>
      {value ? <span className="value" style={{ maxWidth: "68%", textAlign: "right", wordBreak: "break-all" }}>{value}</span> : null}
      {onClick ? <span className="chev">›</span> : null}
    </div>
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

      <div className="me-group">
        <div className="me-group-title">外观主题</div>
        <div className="tabs" style={{ padding: "4px 10px 10px" }}>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`tab-item ${theme === option.value ? "on" : ""}`}
              onClick={() => setTheme(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="form-hint" style={{ padding: "0 14px 12px" }}>跟随系统会随手机的深色模式自动切换。</div>
      </div>

      <div className="me-group">
        <div className="me-group-title">年制偏好</div>
        <div className="tabs" style={{ padding: "4px 10px 10px" }}>
          {YEAR_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`tab-item ${yearMode === option.value ? "on" : ""}`}
              onClick={() => setYearMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="form-hint" style={{ padding: "0 14px 12px" }}>
          无限元年 = 公元 1604 年。
          <button className="link-btn" onClick={() => push("year")}>打开年制换算</button>
        </div>
      </div>

      <div className="section-title">隐私说明</div>
      <div className="info-card">
        <h4>只收集必要的信息</h4>
        <p>账号信息（用户名、邮箱）、你主动发布的内容（帖子、评论、角色设定、反馈），以及保障安全与排障所需的请求日志。不读取通讯录，只有你主动选图时才会访问相册。</p>
        <div className="meta">隐私政策版本 {PRIVACY_VERSION}</div>
      </div>
      <div className="info-card">
        <h4>人机验证与零 PoW</h4>
        <p>APP 使用专属验证通道（/captcha/app/*），一次签名换一张短期凭据，只在登录、注册、评论与反馈时校验；手机不再执行工作量证明，不会因求解而发烫或卡死。该密钥可随时在服务端撤销。</p>
      </div>

      <div className="me-group">
        <div className="me-group-title">关于</div>
        <InfoRow label="版本号" value={`${appInfo?.versionName || "2.0.0"}（${appInfo?.versionCode ?? 20000}）`} />
        <InfoRow label="包名" value={appInfo?.packageName || "—"} />
        <InfoRow label="API 地址" value={appInfo?.apiBaseUrl || "—"} />
        <InfoRow label="彩蛋" value="点一下" onClick={() => void revealEasterEgg()} />
      </div>

      <div style={{ padding: "16px 14px 0" }}>
        {user ? (
          <button className="btn danger block" onClick={() => setConfirmLogout(true)}>退出登录</button>
        ) : (
          <button className="btn primary block" onClick={() => push("auth")}>登录 / 注册</button>
        )}
      </div>

      <div className="me-footer">
        {quote.data?.text ? `${quote.data.text}${quote.data.source ? ` —— ${quote.data.source}` : ""}` : "妖精论坛（二创） · 非商业同人项目"}
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
        <div className="empty">
          <div className="empty-mark">◐</div>
          <p>登录后可以修改密码与管理账号</p>
          <button className="btn primary" onClick={() => push("auth")}>登录 / 注册</button>
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

      <div className="me-group">
        <div className="me-group-title">账号信息</div>
        <InfoRow label="用户名" value={user.name} />
        <InfoRow label="邮箱" value={user.email || "未绑定"} />
        <InfoRow
          label="邮箱验证"
          value={<span style={{ color: verified ? "var(--color-secondary)" : "#e6803d" }}>{verified ? "已验证" : "未验证"}</span>}
        />
        {user.created_at ? <InfoRow label="注册时间" value={formatDate(user.created_at)} /> : null}
      </div>

      <div className="section-title">修改密码</div>
      <div className="screen-pad">
        <div className="field">
          <label>当前密码</label>
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="用于确认是你本人" />
        </div>
        <div className="field">
          <label>新密码</label>
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="至少 8 位，含字母与数字" />
        </div>
        <div className="field">
          <label>确认新密码</label>
          <input className="input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="再输一遍新密码" />
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="btn primary block" disabled={busy} onClick={() => void changePassword()}>{busy ? "提交中…" : "更新密码"}</button>
        <div className="form-hint">修改成功后其他设备上的登录会自动失效，当前设备保持登录。</div>
      </div>

      <div className="section-title">注销账号</div>
      <div className="info-card">
        <h4>请到 Web 端完成注销</h4>
        <p>注销会同时删除帖子、评论、角色设定与关注关系，且不可恢复。为避免误操作，APP 内不提供一键注销：请在浏览器打开论坛网站，登录后进入「账号设置 → 注销账号」按提示确认。</p>
        {!verified ? <p>注销前建议先完成邮箱验证，以便找回账号。</p> : null}
        <div className="meta">{appInfo?.apiBaseUrl ? `当前服务：${appInfo.apiBaseUrl}` : "当前服务：妖精论坛"}</div>
      </div>

      <div style={{ padding: "16px 14px 0" }}>
        <button className="btn danger block" onClick={() => setConfirmLogout(true)}>退出登录</button>
      </div>
      <div className="me-footer">密码只保存加盐哈希，我们不会也无法看到你的原密码。</div>

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
