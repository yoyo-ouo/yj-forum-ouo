import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PRIVACY_VERSION, useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { AppBar, Cell, Confirm, Empty, Screen, Segmented, Sheet } from "../components/mobile";
import { Icon, type IconName } from "../components/icons";
import { formatDate } from "../lib/format";
import type { Theme } from "../lib/types";

interface ThemeOption {
  value: Theme;
  label: string;
  sub: string;
  icon: IconName;
  toast: string;
}

/** 三套可选色板 + 站庆「国庆红金」叠层（后者由站方统一启用，不在此切换） */
const THEME_OPTIONS: ThemeOption[] = [
  { value: "auto", label: "跟随系统", sub: "随手机的深色模式自动切换", icon: "refresh", toast: "已跟随系统外观" },
  { value: "day", label: "日间", sub: "明亮米白界面，白天更清晰", icon: "sun", toast: "已切换为日间模式" },
  { value: "night", label: "夜间", sub: "深色界面，弱光环境更舒服", icon: "moon", toast: "已切换为夜间模式" },
];

const YEAR_ITEMS: Array<{ key: "wuxian" | "ce"; label: string }> = [
  { key: "wuxian", label: "无限年" },
  { key: "ce", label: "公元年" },
];

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
  const { push, top } = useNav();
  const [privacyOpen, setPrivacyOpen] = useState(Boolean(top.params?.privacy));
  const [thanksOpen, setThanksOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [nationalOn, setNationalOn] = useState(false);

  // 国庆红金由站方在节庆期间给 <html> 加类，这里只读取展示
  useEffect(() => {
    setNationalOn(document.documentElement.classList.contains("theme-national"));
  }, []);

  const quote = useQuery({
    queryKey: ["daily-quote"],
    queryFn: () => api.dailyQuote(),
    staleTime: 10 * 60_000,
    retry: 0,
    enabled: consented,
  });

  const chooseTheme = (option: ThemeOption) => {
    if (theme === option.value) return;
    setTheme(option.value);
    showToast(option.toast);
  };

  const chooseYear = (mode: "wuxian" | "ce") => {
    if (yearMode === mode) return;
    setYearMode(mode);
    showToast(mode === "ce" ? "已切换为公元年" : "已切换为无限年");
  };

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
    <>
      <Screen appbar={<AppBar back title="设置" />}>
        {/* 外观 */}
        <div className="m-section-title">外观</div>
        <div className="m-list">
          {THEME_OPTIONS.map((option) => (
            <Cell
              key={option.value}
              icon={option.icon}
              label={option.label}
              sub={option.sub}
              chevron={false}
              onClick={() => chooseTheme(option)}
              right={
                <span className={`st-check ${theme === option.value ? "on" : ""}`}>
                  {theme === option.value ? <Icon name="check" size={16} /> : <span className="st-check-dot" />}
                </span>
              }
            />
          ))}
          <Cell
            icon="sparkle"
            label="国庆红金"
            sub="站庆期间由站方统一启用，与日间/夜间共用"
            chevron={false}
            right={
              <span className={`st-check ${nationalOn ? "on" : ""}`}>
                {nationalOn ? <Icon name="check" size={16} /> : <span className="st-flag">站庆</span>}
              </span>
            }
          />
          <div className="st-row">
            <span className="st-row-icon"><Icon name="clock" size={18} /></span>
            <span className="st-row-label">年制</span>
            <Segmented items={YEAR_ITEMS} value={yearMode} onChange={chooseYear} className="st-seg" />
          </div>
          <div className="st-hint st-hint-row">
            <span>无限元年 = 公元 1604 年</span>
            <button type="button" className="st-link" onClick={() => push("year")}>打开年制换算</button>
          </div>
        </div>

        {/* 隐私与安全 */}
        <div className="m-section-title">隐私与安全</div>
        <div className="m-list">
          <Cell icon="shield" label="隐私政策版本" value={PRIVACY_VERSION} chevron={false} />
          <Cell
            icon="eye"
            label="查看隐私说明"
            sub="账号信息、内容与请求日志的收集范围"
            onClick={() => setPrivacyOpen(true)}
          />
          <Cell
            icon="user"
            label="账号安全"
            sub={user ? "修改密码与注销说明" : "登录后查看"}
            onClick={() => push("account")}
          />
        </div>

        {/* 关于 */}
        <div className="m-section-title">关于</div>
        <div className="m-list">
          <Cell
            icon="download"
            label="版本号"
            value={`${appInfo?.versionName || "2.0.0"}（${appInfo?.versionCode ?? 20000}）`}
            onClick={() => push("version")}
          />
          <Cell icon="list" label="更新日志" onClick={() => push("changelog")} />
          <Cell icon="mail" label="意见反馈" onClick={() => push("feedback")} />
          <Cell icon="sparkle" label="彩蛋" sub="点一下，看看今天运气如何" onClick={() => void revealEasterEgg()} />
          <Cell icon="info" label="开源与致谢" onClick={() => setThanksOpen(true)} />
        </div>

        {/* 登录 / 退出 */}
        {user ? (
          <div className="m-list st-danger-list">
            <Cell icon="logout" label="退出登录" danger chevron={false} onClick={() => setConfirmLogout(true)} />
          </div>
        ) : (
          <div className="m-list st-danger-list">
            <Cell icon="user" label="登录 / 注册" sub="登录后可修改密码、管理账号" onClick={() => push("auth")} />
          </div>
        )}

        <div className="st-footer">
          {quote.data?.text
            ? `${quote.data.text}${quote.data.source ? ` —— ${quote.data.source}` : ""}`
            : "妖精论坛（二创） · 非商业同人项目"}
        </div>
      </Screen>

      <Sheet open={privacyOpen} title="隐私" onClose={() => setPrivacyOpen(false)}>
        <div className="st-sheet">
          <p>
            只收集必要的信息：账号信息（用户名、邮箱）、你主动发布的内容（帖子、评论、角色设定、反馈），以及保障安全与排障所需的请求日志。
          </p>
          <ul>
            <li>不读取通讯录，只有你主动选图时才会访问相册。</li>
            <li>密码只保存加盐哈希，我们不会也无法看到你的原密码。</li>
            <li>请求日志只用于安全与排障，并按期限滚动清理。</li>
            <li>
              APP 使用专属零 PoW 人机验证通道：一次签名换一张短期凭据，只在登录、注册、评论与反馈时校验，手机不会因求解哈希而发烫。
            </li>
          </ul>
          <span className="st-sheet-ver">隐私政策版本 {PRIVACY_VERSION}</span>
        </div>
      </Sheet>

      <Sheet open={thanksOpen} title="开源与致谢" onClose={() => setThanksOpen(false)}>
        <div className="st-sheet">
          <p>妖精论坛 APP 基于这些开源项目构建，感谢每一位作者：</p>
          <ul>
            <li>React 19 · 界面框架</li>
            <li>Capacitor 8 · 原生能力桥接</li>
            <li>TanStack Query · 数据请求与缓存</li>
            <li>Zustand · 全局状态</li>
            <li>TipTap / ProseMirror · 富文本编辑器</li>
            <li>marked · Markdown 渲染</li>
            <li>DOMPurify · 富文本清洗</li>
            <li>Font Awesome 4.7 · 部分图标</li>
          </ul>
          <p>也感谢《罗小黑战记》原作与所有同人创作者。</p>
          <span className="st-sheet-ver">妖精论坛（二创） · 非商业同人项目</span>
        </div>
      </Sheet>

      <Confirm
        open={confirmLogout}
        title="退出登录？"
        confirmText="退出"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          void logout().then(() => showToast("已退出登录"));
        }}
      >
        退出后需要重新登录才能发帖与评论。
      </Confirm>
    </>
  );
}

/* ---------------- 账号安全 ---------------- */

function InfoCell({ icon, label, value }: { icon: IconName; label: string; value: React.ReactNode }) {
  return (
    <div className="m-cell st-info-cell">
      <span className="m-cell-icon"><Icon name={icon} size={18} /></span>
      <span className="m-cell-label">
        <span className="m-ellipsis" style={{ display: "block" }}>{label}</span>
      </span>
      <span className="m-cell-value st-info-value">{value}</span>
    </div>
  );
}

export function AccountScreen() {
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { push } = useNav();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logout = useApp((s) => s.logout);

  if (!user) {
    return (
      <Screen appbar={<AppBar back title="账号安全" />}>
        <Empty
          icon="shield"
          title="请先登录"
          hint="登录后可以查看账号信息、修改密码"
          action={
            <button className="m-btn m-btn--primary" onClick={() => push("auth")}>
              登录 / 注册
            </button>
          }
        />
      </Screen>
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
    <Screen appbar={<AppBar back title="账号安全" />}>
      {/* 账号信息 */}
      <div className="m-section-title">账号信息</div>
      <div className="m-list">
        <InfoCell icon="user" label="用户名" value={user.name} />
        <InfoCell icon="mail" label="邮箱" value={user.email || <span className="st-muted">未绑定</span>} />
        <InfoCell
          icon="shield"
          label="邮箱验证状态"
          value={
            verified ? (
              <span className="st-verify"><Icon name="check" size={14} />已认证</span>
            ) : (
              <span className="st-muted">未验证</span>
            )
          }
        />
        {user.created_at ? (
          <InfoCell icon="clock" label="注册时间" value={formatDate(user.created_at)} />
        ) : null}
      </div>

      {/* 修改密码 */}
      <div className="m-section-title">修改密码</div>
      <div className="m-card st-form">
        <div className="st-field">
          <label className="m-label" htmlFor="st-current-password">当前密码</label>
          <input
            id="st-current-password"
            className="m-input"
            type="password"
            autoComplete="current-password"
            placeholder="用于确认是你本人"
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value);
              if (error) setError("");
            }}
          />
        </div>
        <div className="st-field">
          <label className="m-label" htmlFor="st-new-password">新密码</label>
          <input
            id="st-new-password"
            className="m-input"
            type="password"
            autoComplete="new-password"
            placeholder="设置新密码"
            value={next}
            onChange={(event) => {
              setNext(event.target.value);
              if (error) setError("");
            }}
          />
          <p className="st-field-hint">至少 8 位，含字母与数字</p>
        </div>
        <div className="st-field">
          <label className="m-label" htmlFor="st-repeat-password">确认新密码</label>
          <input
            id="st-repeat-password"
            className="m-input"
            type="password"
            autoComplete="new-password"
            placeholder="再输一遍新密码"
            value={repeat}
            onChange={(event) => {
              setRepeat(event.target.value);
              if (error) setError("");
            }}
          />
        </div>
        {error ? <p className="st-error" role="alert">{error}</p> : null}
        <button
          type="button"
          className="m-btn m-btn--primary m-btn--block st-submit"
          disabled={busy}
          onClick={() => void changePassword()}
        >
          {busy ? "提交中…" : "更新密码"}
        </button>
      </div>

      {/* 注销说明 */}
      <div className="st-footnote">
        <div className="st-footnote-title">关于注销账号</div>
        <p>
          注销会同时删除帖子、评论、角色设定与关注关系，且不可恢复。为避免误操作，APP 内不提供一键注销：请在浏览器打开论坛网站，登录后进入「账号设置 → 注销账号」按提示确认。
        </p>
        {!verified ? <p>注销前建议先完成邮箱验证，以便找回账号。</p> : null}
        <p>密码只保存加盐哈希，我们不会也无法看到你的原密码。</p>
      </div>

      <div className="m-list st-logout">
        <Cell icon="logout" label="退出登录" danger chevron={false} onClick={() => setConfirmLogout(true)} />
      </div>

      <Confirm
        open={confirmLogout}
        title="退出登录？"
        confirmText="退出"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          void logout().then(() => showToast("已退出登录"));
        }}
      >
        退出后需要重新登录才能发帖与评论。
      </Confirm>
    </Screen>
  );
}
