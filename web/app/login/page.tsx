"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import { authApi, ApiException } from "@/lib/api";
import { useStore } from "@/lib/store";

type Mode = "login" | "register" | "forgot";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { refreshUser } = useStore();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // URL ?mode=reset&token= 兼容（旧 token 链接流程：需要验证码模式）
  const modeParam = params.get("mode");
  useEffect(() => {
    if (modeParam === "reset") {
      setMode("forgot");
    }
  }, [modeParam]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const showMsg = (m: string) => { setMsg(m); setErr(m); };

  const login = async () => {
    if (!name || !password) return showMsg("请输入账号和密码");
    setBusy(true);
    try {
      const r = await authApi.login(name, password, remember);
      await refreshUser();
      router.push(`/users/${r.id}`);
    } catch (e) {
      showMsg(e instanceof ApiException ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const sendRegisterCode = async () => {
    if (!email) return showMsg("请输入邮箱");
    setBusy(true);
    try {
      await authApi.sendRegisterCode(email);
      setMsg("验证码已发送，请查收邮箱");
      setCountdown(60);
    } catch (e) {
      showMsg(e instanceof ApiException ? e.message : "发送失败");
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (!name || !email || !password || !code) return showMsg("请填写完整信息");
    if (password.length < 8) return showMsg("密码至少8位");
    if (password !== password2) return showMsg("两次密码不一致");
    setBusy(true);
    try {
      await authApi.register(name, email, password, code);
      await refreshUser();
      router.push("/");
    } catch (e) {
      showMsg(e instanceof ApiException ? e.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  const sendResetCode = async () => {
    if (!email) return showMsg("请输入邮箱");
    setBusy(true);
    try {
      await authApi.sendResetCode(email);
      setMsg("验证码已发送（若邮箱存在）");
      setCountdown(60);
    } catch (e) {
      showMsg(e instanceof ApiException ? e.message : "发送失败");
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email || !code || !password) return showMsg("请填写完整信息");
    if (password.length < 8) return showMsg("密码至少8位");
    if (password !== password2) return showMsg("两次密码不一致");
    setBusy(true);
    try {
      await authApi.resetPassword(email, code, password);
      showMsg("密码重置成功，请使用新密码登录");
      setMode("login");
    } catch (e) {
      showMsg(e instanceof ApiException ? e.message : "重置失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-container" style={{ maxWidth: 420, margin: "40px auto", padding: 24, borderRadius: 12, background: "var(--color-bg-secondary, #fff)", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
      <div className="auth-tabs" style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={`forum-tab ${mode === "login" ? "active" : ""}`} onClick={() => { setMode("login"); setMsg(""); setErr(""); }}>登录</button>
        <button className={`forum-tab ${mode === "register" ? "active" : ""}`} onClick={() => { setMode("register"); setMsg(""); setErr(""); }}>注册</button>
        <button className={`forum-tab ${mode === "forgot" ? "active" : ""}`} onClick={() => { setMode("forgot"); setMsg(""); setErr(""); }}>忘记密码</button>
      </div>

      {mode === "login" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input className="form-editor" placeholder="邮箱或用户名" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="form-editor" type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} />
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 记住我（30天）
          </label>
          <button className="submit-button" disabled={busy} onClick={login}>{busy ? "登录中..." : "登录"}</button>
        </div>
      )}

      {mode === "register" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input className="form-editor" placeholder="用户名（2-20字符）" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="form-editor" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <input className="form-editor" placeholder="6位验证码" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="submit-button" style={{ whiteSpace: "nowrap", width: 120 }} disabled={busy || countdown > 0} onClick={sendRegisterCode}>
              {countdown > 0 ? `${countdown}s` : "发送验证码"}
            </button>
          </div>
          <input className="form-editor" type="password" placeholder="密码（至少8位，含字母数字）" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className="form-editor" type="password" placeholder="确认密码" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          <button className="submit-button" disabled={busy} onClick={register}>{busy ? "注册中..." : "注册"}</button>
        </div>
      )}

      {mode === "forgot" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input className="form-editor" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <input className="form-editor" placeholder="6位验证码" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="submit-button" style={{ whiteSpace: "nowrap", width: 120 }} disabled={busy || countdown > 0} onClick={sendResetCode}>
              {countdown > 0 ? `${countdown}s` : "发送验证码"}
            </button>
          </div>
          <input className="form-editor" type="password" placeholder="新密码（至少8位）" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className="form-editor" type="password" placeholder="确认新密码" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          <button className="submit-button" disabled={busy} onClick={resetPassword}>{busy ? "提交中..." : "重置密码"}</button>
        </div>
      )}

      {msg && <p style={{ marginTop: 12, color: "var(--color-text-secondary, #666)", fontSize: 13 }}>{msg}</p>}
    </div>
  );
}

export default function LoginPage() {
  return (
    <>
      <Header />
      <Suspense fallback={<div style={{ textAlign: "center", padding: 40 }}>加载中...</div>}>
        <LoginInner />
      </Suspense>
    </>
  );
}
