import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { Confirm, TopBar } from "../components/ui";
// 仅本页需要的移动端适配（卡片宽度 / 验证码行 / 禁用态），不改 main.tsx 与共享样式
import "../styles/search-compose-auth-page.css";

type AuthMode = "login" | "register";

export function AuthScreen() {
  const user = useApp((s) => s.user);
  const appInfo = useApp((s) => s.appInfo);
  const refreshUser = useApp((s) => s.refreshUser);
  const showToast = useApp((s) => s.showToast);
  const { pop } = useNav();

  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  // 隐私政策与服务条款勾选（默认不勾选）；未勾选时先弹窗确认（对齐 Web）
  const [agreed, setAgreed] = useState(false);
  const [agreePrompt, setAgreePrompt] = useState(false);
  const [pendingAction, setPendingAction] = useState<AuthMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");

  // 验证码倒计时（60 秒，对齐 Web）
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const pwdMatch: "" | "ok" | "no" = !password2 ? "" : password === password2 ? "ok" : "no";

  const doLogin = async () => {
    if (busy) return;
    if (!name.trim() || !password) {
      setError("请输入账号和密码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.login(name.trim(), password, remember);
      await refreshUser();
      showToast("登录成功");
      pop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const doRegister = async () => {
    if (busy) return;
    if (!name.trim() || !email.trim() || !password || !code.trim()) {
      setError("请填写完整信息");
      return;
    }
    if (password.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    if (password !== password2) {
      setError("两次密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.register({ name: name.trim(), email: email.trim(), password, code: code.trim() });
      await refreshUser();
      showToast("注册成功，已为你登录");
      pop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    if (sending || countdown > 0) return;
    if (!email.trim()) {
      setError("请先填写邮箱");
      return;
    }
    setSending(true);
    setError("");
    try {
      await api.registerCode(email.trim());
      showToast("验证码已发送，请查收邮箱");
      setCountdown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  // 未勾选协议时先弹窗确认；确认后自动勾选并继续刚才的操作
  const requireAgreement = (action: AuthMode): boolean => {
    if (agreed) return true;
    setPendingAction(action);
    setAgreePrompt(true);
    return false;
  };

  const login = () => {
    if (requireAgreement("login")) void doLogin();
  };

  const register = () => {
    if (requireAgreement("register")) void doRegister();
  };

  const confirmAgreement = () => {
    setAgreed(true);
    setAgreePrompt(false);
    const action = pendingAction;
    setPendingAction(null);
    if (action === "login") void doLogin();
    else if (action === "register") void doRegister();
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError("");
  };

  /* ------------------------------ 已登录 ------------------------------ */
  if (user) {
    return (
      <div className="screen">
        <TopBar title="账号" back />
        <div className="auth-page">
          <div className="auth-card">
            <div className="auth-form">
              <div className="auth-header">
                <h2>你已登录</h2>
                <p>当前账号：{user.name}</p>
              </div>
              <button type="button" className="auth-btn primary" onClick={pop}>
                返回
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title={mode === "login" ? "登录" : "注册"} back />
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${mode === "login" ? "active" : ""}`}
              data-tab="login"
              onClick={() => switchMode("login")}
            >
              登录
            </button>
            <button
              type="button"
              className={`auth-tab ${mode === "register" ? "active" : ""}`}
              data-tab="register"
              onClick={() => switchMode("register")}
            >
              注册
            </button>
          </div>

          {mode === "login" ? (
            <div className="auth-form" id="loginForm">
              <div className="auth-header">
                <h2>欢迎回来</h2>
                <p>登录您的妖精论坛账号</p>
              </div>

              <div className="auth-input-group">
                <span className="auth-icon">
                  <i className="fa fa-user" />
                </span>
                <input
                  type="text"
                  name="username"
                  placeholder="用户名或邮箱"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="auth-input-group">
                <span className="auth-icon">
                  <i className="fa fa-lock" />
                </span>
                <input
                  type="password"
                  name="password"
                  placeholder="密码"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") login();
                  }}
                />
              </div>

              <div className="auth-options">
                <label className="remember-me">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                  <span>记住我</span>
                </label>
              </div>

              <label className="auth-agree">
                <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
                <span>
                  我已阅读并同意
                  <span style={{ color: "var(--color-primary)" }}>《隐私政策》</span>
                  和
                  <span style={{ color: "var(--color-primary)" }}>《服务条款》</span>
                </span>
              </label>

              <button type="button" className="auth-btn primary" disabled={busy} onClick={login}>
                {busy ? "登录中..." : "登录"}
              </button>
              <div className="auth-error">{error}</div>
            </div>
          ) : null}

          {mode === "register" ? (
            <div className="auth-form" id="registerForm">
              <div className="auth-header">
                <h2>加入我们</h2>
                <p>创建您的妖精论坛账号</p>
              </div>

              <div className="auth-input-group">
                <span className="auth-icon">
                  <i className="fa fa-user" />
                </span>
                <input
                  type="text"
                  name="new-username"
                  placeholder="用户名（2-20个字符）"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="auth-input-group">
                <span className="auth-icon">
                  <i className="fa fa-envelope" />
                </span>
                <input
                  type="email"
                  name="email"
                  placeholder="邮箱"
                  autoComplete="email"
                  autoCapitalize="none"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="auth-input-group">
                <span className="auth-icon">
                  <i className="fa fa-lock" />
                </span>
                <input
                  type="password"
                  name="new-password"
                  placeholder="密码（至少8位，含字母和数字）"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              <div className="auth-input-group">
                <span className="auth-icon">
                  <i className="fa fa-lock" />
                </span>
                <input
                  type="password"
                  name="confirm-password"
                  placeholder="确认密码"
                  autoComplete="new-password"
                  value={password2}
                  onChange={(event) => setPassword2(event.target.value)}
                />
              </div>

              <div className="auth-code-row">
                <div className="auth-input-group">
                  <span className="auth-icon">
                    <i className="fa fa-shield" />
                  </span>
                  <input
                    type="text"
                    name="code"
                    placeholder="验证码（6位数字）"
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </div>
                <button type="button" className="auth-btn" disabled={sending || countdown > 0} onClick={() => void sendCode()}>
                  {countdown > 0 ? `${countdown}s` : sending ? "发送中..." : "获取验证码"}
                </button>
              </div>

              <label className="auth-agree">
                <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
                <span>
                  我已阅读并同意
                  <span style={{ color: "var(--color-primary)" }}>《隐私政策》</span>
                  和
                  <span style={{ color: "var(--color-primary)" }}>《服务条款》</span>
                </span>
              </label>

              <button type="button" className="auth-btn primary" disabled={busy} onClick={register}>
                {busy ? "注册中..." : "注册"}
              </button>
              <div className="auth-error">
                {error ? error : pwdMatch === "no" ? "❌ 两次密码不一致" : pwdMatch === "ok" ? "✅ 密码一致" : ""}
              </div>
            </div>
          ) : null}

          {appInfo && !appInfo.altchaConfigured ? (
            <div className="auth-footer">
              <p style={{ color: "#e74c3c" }}>当前构建未注入 APP 零 PoW 密钥，登录可能失败，请联系站务。</p>
            </div>
          ) : null}

          <div className="auth-footer">
            <p>
              <i className="fa fa-shield" /> APP 通道已启用零 PoW 人机验证：登录、注册与发送验证码由服务端签发凭证，不再在手机上求解哈希谜题。
            </p>
            <p style={{ marginTop: 8 }}>
              请妥善保管账号与密码，不要与他人共享；信息仅按《隐私政策》与《服务条款》说明的方式收集与使用。
            </p>
          </div>
        </div>
      </div>

      <Confirm
        open={agreePrompt}
        title="同意隐私政策与服务条款"
        confirmText="同意并继续"
        onCancel={() => {
          setAgreePrompt(false);
          setPendingAction(null);
        }}
        onConfirm={confirmAgreement}
      >
        <p className="auth-agree-text">
          继续即表示你已阅读并同意《隐私政策》与《服务条款》，我们只会按照上述文件说明的方式收集与使用信息。
        </p>
      </Confirm>
    </div>
  );
}
