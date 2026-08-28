"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
  const [pwdMatch, setPwdMatch] = useState<"" | "ok" | "no">("");

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
      setErr("");
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
      setErr("");
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

  const switchMode = (m: Mode) => {
    setMode(m);
    setMsg("");
    setErr("");
    setPwdMatch("");
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-tabs">
          <button className={`auth-tab ${mode === "login" ? "active" : ""}`} data-tab="login" onClick={() => switchMode("login")}>登录</button>
          <button className={`auth-tab ${mode === "register" ? "active" : ""}`} data-tab="register" onClick={() => switchMode("register")}>注册</button>
        </div>

        {mode === "login" && (
          <div className="auth-form" id="loginForm">
            <div className="auth-header">
              <h2>欢迎回来</h2>
              <p>登录您的妖精论坛账号</p>
            </div>
            <div className="auth-input-group">
              <span className="auth-icon"><i className="fa fa-user"></i></span>
              <input type="text" placeholder="用户名或邮箱" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="auth-input-group">
              <span className="auth-icon"><i className="fa fa-lock"></i></span>
              <input type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
            </div>
            <div className="auth-options">
              <label className="remember-me">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>记住我</span>
              </label>
              <a href="#" className="forgot-password" onClick={(e) => { e.preventDefault(); switchMode("forgot"); }}>忘记密码？</a>
            </div>
            <button className="auth-btn primary" disabled={busy} onClick={login}>{busy ? "登录中..." : "登录"}</button>
            <div className="auth-error">{err}</div>
          </div>
        )}

        {mode === "register" && (
          <div className="auth-form" id="registerForm">
            <div className="auth-header">
              <h2>加入我们</h2>
              <p>创建您的妖精论坛账号</p>
            </div>
            <div className="auth-input-group">
              <span className="auth-icon"><i className="fa fa-user"></i></span>
              <input type="text" placeholder="用户名（2-20个字符）" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="auth-input-group">
              <span className="auth-icon"><i className="fa fa-envelope"></i></span>
              <input type="email" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="auth-input-group">
              <span className="auth-icon"><i className="fa fa-lock"></i></span>
              <input
                type="password"
                placeholder="密码（至少8位，含字母和数字）"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setPwdMatch(password2 && e.target.value === password2 ? "ok" : password2 ? "no" : ""); }}
              />
            </div>
            <div className="auth-input-group">
              <span className="auth-icon"><i className="fa fa-lock"></i></span>
              <input
                type="password"
                placeholder="确认密码"
                value={password2}
                onChange={(e) => { setPassword2(e.target.value); setPwdMatch(password && e.target.value === password ? "ok" : e.target.value ? "no" : ""); }}
              />
            </div>
            <div className="auth-input-group auth-code-group">
              <span className="auth-icon"><i className="fa fa-shield"></i></span>
              <input type="text" placeholder="验证码（6位数字）" maxLength={6} inputMode="numeric" pattern="[0-9]*" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="auth-btn code-btn" disabled={busy || countdown > 0} onClick={sendRegisterCode}>
                {countdown > 0 ? `${countdown}s` : "获取验证码"}
              </button>
            </div>
            <button className="auth-btn primary" disabled={busy} onClick={register}>{busy ? "注册中..." : "注册"}</button>
            <div className="auth-error">{err || (pwdMatch === "no" ? "❌ 两次密码不一致" : pwdMatch === "ok" ? "✅ 密码一致" : "")}</div>
          </div>
        )}

        {mode === "forgot" && (
          <div className="auth-form" id="forgotPasswordForm">
            <div className="auth-header">
              <h2>重置密码</h2>
              <p>输入邮箱获取验证码，设置新密码</p>
            </div>
            <div className="auth-input-group">
              <span className="auth-icon"><i className="fa fa-envelope"></i></span>
              <input type="email" placeholder="注册邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="auth-input-group auth-code-group">
              <span className="auth-icon"><i className="fa fa-shield"></i></span>
              <input type="text" placeholder="验证码（6位数字）" maxLength={6} inputMode="numeric" pattern="[0-9]*" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="auth-btn code-btn" disabled={busy || countdown > 0} onClick={sendResetCode}>
                {countdown > 0 ? `${countdown}s` : "获取验证码"}
              </button>
            </div>
            <div className="auth-input-group">
              <span className="auth-icon"><i className="fa fa-lock"></i></span>
              <input type="password" placeholder="新密码（至少8位，含字母和数字）" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="auth-input-group">
              <span className="auth-icon"><i className="fa fa-lock"></i></span>
              <input type="password" placeholder="确认新密码" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </div>
            <button className="auth-btn primary" disabled={busy} onClick={resetPassword}>{busy ? "提交中..." : "重置密码"}</button>
            <div className="auth-error">{err}</div>
            <button className="auth-btn secondary" style={{ marginTop: 12, background: "var(--color-bg-icon)", color: "var(--color-text-secondary)" }} onClick={() => switchMode("login")}>返回登录</button>
          </div>
        )}

        <div className="auth-footer">
          <p>登录即表示您同意<Link href="/privacy">隐私政策</Link>和服务条款</p>
        </div>
      </div>
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
