import React, { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { TopBar } from "../components/ui";

export function AuthScreen() {
  const user = useApp((s) => s.user);
  const appInfo = useApp((s) => s.appInfo);
  const refreshUser = useApp((s) => s.refreshUser);
  const showToast = useApp((s) => s.showToast);
  const { pop } = useNav();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  if (user) {
    return (
      <div className="screen">
        <TopBar title="账号" back />
        <div className="empty">
          <div className="empty-mark">✓</div>
          <p>已登录为 {user.name}</p>
          <button className="btn ghost" onClick={pop}>返回</button>
        </div>
      </div>
    );
  }

  const sendCode = async () => {
    if (!email.trim()) return setError("请先填写邮箱");
    setSending(true);
    setError("");
    try {
      await api.registerCode(email.trim());
      showToast("验证码已发送");
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    setError("");
    if (!name.trim() || !password) return setError("请填写用户名与密码");
    if (mode === "register" && (!email.trim() || !code.trim())) return setError("请填写邮箱与验证码");
    setBusy(true);
    try {
      if (mode === "login") {
        await api.login(name.trim(), password, remember);
      } else {
        await api.register({ name: name.trim(), email: email.trim(), password, code: code.trim() });
      }
      await refreshUser();
      showToast(mode === "login" ? "登录成功" : "注册成功");
      pop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <TopBar title={mode === "login" ? "登录" : "注册"} back />
      <div className="auth-page">
        <div className="boot-logo" style={{ margin: 0 }}>妖</div>
        <h1 className="auth-title">{mode === "login" ? "欢迎回来" : "加入妖精论坛"}</h1>
        <p className="auth-sub">APP 已启用零 PoW 验证，登录与评论不再等待求解。</p>
        <div className="auth-tabs">
          <button className={`auth-tab ${mode === "login" ? "on" : ""}`} onClick={() => { setMode("login"); setError(""); }}>登录</button>
          <button className={`auth-tab ${mode === "register" ? "on" : ""}`} onClick={() => { setMode("register"); setError(""); }}>注册</button>
        </div>
        <div className="field">
          <label>{mode === "login" ? "用户名或邮箱" : "用户名"}</label>
          <input className="input" value={name} autoCapitalize="none" autoCorrect="off" onChange={(e) => setName(e.target.value)} placeholder="请输入用户名" />
        </div>
        {mode === "register" ? (
          <>
            <div className="field">
              <label>邮箱</label>
              <input className="input" value={email} inputMode="email" autoCapitalize="none" onChange={(e) => setEmail(e.target.value)} placeholder="用于接收验证码" />
            </div>
            <div className="field">
              <label>邮箱验证码</label>
              <div className="row">
                <input className="input" value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" />
                <button className="btn ghost sm" disabled={sending} onClick={() => void sendCode()}>{sending ? "发送中…" : "发送"}</button>
              </div>
            </div>
          </>
        ) : null}
        <div className="field">
          <label>密码</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位，含字母与数字" />
        </div>
        {mode === "login" ? (
          <label className="row small muted" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            保持登录 14 天
          </label>
        ) : null}
        {error ? <div className="form-error">{error}</div> : null}
        {appInfo && !appInfo.altchaConfigured ? <div className="form-error">当前构建未注入 APP 零 PoW 密钥，登录可能失败，请联系站务。</div> : null}
        <button className="btn primary block" disabled={busy} onClick={() => void submit()}>{busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}</button>
        <div className="form-hint center" style={{ marginTop: 14 }}>登录即表示同意《用户条款》与《隐私政策》</div>
      </div>
    </div>
  );
}
