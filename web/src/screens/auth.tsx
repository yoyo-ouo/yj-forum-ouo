import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { openExternal, requestApi } from "../lib/native";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { AppBar, Confirm, Empty, Screen, Segmented, Sheet } from "../components/mobile";
import { Icon } from "../components/icons";

/** 三种模式：登录 / 注册 / 邮箱验证（用注册邮箱找回密码） */
type AuthMode = "login" | "register" | "verify";

type DocKey = "privacy" | "terms";

const SITE = "https://www.yjlt.top";

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
  const [pwdVisible, setPwdVisible] = useState(false);
  const [pwd2Visible, setPwd2Visible] = useState(false);
  // 隐私政策与服务条款勾选（默认不勾选）；未勾选时先弹窗确认（对齐 Web）
  const [agreed, setAgreed] = useState(false);
  const [agreePrompt, setAgreePrompt] = useState(false);
  const [pendingAction, setPendingAction] = useState<AuthMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [resetSending, setResetSending] = useState(false);
  const [resetCountdown, setResetCountdown] = useState(0);
  const [error, setError] = useState("");
  const [docOpen, setDocOpen] = useState<DocKey | null>(null);
  const [codeLoginOpen, setCodeLoginOpen] = useState(false);

  // 验证码 / 重置链接倒计时（60 秒，对齐 Web）
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (resetCountdown <= 0) return;
    const timer = window.setTimeout(() => setResetCountdown((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [resetCountdown]);

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

  // 邮箱验证：向注册邮箱发送重置密码链接（人机验证由原生桥自动附带凭证）
  const sendResetLink = async () => {
    if (resetSending || resetCountdown > 0) return;
    const target = email.trim();
    if (!target) {
      setError("请先填写注册邮箱");
      return;
    }
    setResetSending(true);
    setError("");
    try {
      const res = await requestApi({ method: "POST", path: "/auth/password/reset/link", body: { email: target } });
      const data: any = res.data;
      if (!res.ok || data?.success === false) throw new Error(data?.message || "发送失败");
      showToast("重置链接已发送，请查收邮箱");
      setResetCountdown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setResetSending(false);
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
    setCodeLoginOpen(false);
  };

  const submit = () => {
    if (mode === "login") login();
    else if (mode === "register") register();
    else void sendResetLink();
  };

  const inlineError = error || (mode === "register" && pwdMatch === "no" ? "两次密码不一致" : "");

  // 政策 / 条款里的链接按钮：阻止 label 把点击转发给 checkbox
  const openDoc = (key: DocKey) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDocOpen(key);
  };

  /* ------------------------------ 已登录 ------------------------------ */
  if (user) {
    return (
      <Screen appbar={<AppBar back plain />} bodyClassName="au-body">
        <Empty
          icon="user"
          title="你已登录"
          hint={`当前账号：${user.name}`}
          action={<button type="button" className="m-btn m-btn--primary" onClick={pop}>返回</button>}
        />
      </Screen>
    );
  }

  /* ------------------------------ 模式文案 ------------------------------ */
  const heading = mode === "register" ? "加入妖精论坛" : mode === "verify" ? "邮箱验证" : "欢迎回来";
  const subtitle =
    mode === "register"
      ? "注册一个账号，和妖精们一起聊天"
      : mode === "verify"
        ? "输入注册邮箱，我们会发送重置密码的链接"
        : "登录你的妖精论坛账号";

  const primaryText =
    mode === "login"
      ? busy ? "登录中…" : "登录"
      : mode === "register"
        ? busy ? "注册中…" : "注册"
        : resetSending ? "发送中…" : resetCountdown > 0 ? `${resetCountdown}s 后可重发` : "发送重置链接";

  return (
    <Screen appbar={<AppBar back plain />} bodyClassName="au-body">
      <div className="au-wrap">
        <div className="au-brand" aria-hidden="true">妖</div>
        <h1 className="au-title">{heading}</h1>
        <p className="au-sub">{subtitle}</p>

        {mode !== "verify" ? (
          <Segmented
            className="au-seg"
            value={mode === "register" ? "register" : "login"}
            onChange={(key) => switchMode(key as AuthMode)}
            items={[
              { key: "login", label: "登录" },
              { key: "register", label: "注册" },
            ]}
          />
        ) : null}

        <form
          className="au-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {mode === "login" ? (
            <>
              <div className="au-field">
                <label className="au-label" htmlFor="au-name">账号</label>
                <input
                  id="au-name"
                  className="au-input"
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

              <div className="au-field">
                <label className="au-label" htmlFor="au-pwd">密码</label>
                <div className="au-input-wrap">
                  <input
                    id="au-pwd"
                    className="au-input"
                    type={pwdVisible ? "text" : "password"}
                    name="password"
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className={`au-eye ${pwdVisible ? "on" : ""}`.trim()}
                    aria-label={pwdVisible ? "隐藏密码" : "显示密码"}
                    onClick={() => setPwdVisible((visible) => !visible)}
                  >
                    <Icon name="eye" size={18} />
                  </button>
                </div>
              </div>

              <label className="au-check">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>记住我（下次免登录）</span>
              </label>
            </>
          ) : null}

          {mode === "register" ? (
            <>
              <div className="au-field">
                <label className="au-label" htmlFor="au-new-name">用户名</label>
                <input
                  id="au-new-name"
                  className="au-input"
                  type="text"
                  name="new-username"
                  placeholder="2-20 个字符"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="au-field">
                <label className="au-label" htmlFor="au-email">邮箱</label>
                <input
                  id="au-email"
                  className="au-input"
                  type="email"
                  name="email"
                  placeholder="用于接收验证码与找回账号"
                  autoComplete="email"
                  autoCapitalize="none"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="au-field">
                <label className="au-label" htmlFor="au-new-pwd">密码</label>
                <div className="au-input-wrap">
                  <input
                    id="au-new-pwd"
                    className="au-input"
                    type={pwdVisible ? "text" : "password"}
                    name="new-password"
                    placeholder="至少 8 位，建议含字母和数字"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className={`au-eye ${pwdVisible ? "on" : ""}`.trim()}
                    aria-label={pwdVisible ? "隐藏密码" : "显示密码"}
                    onClick={() => setPwdVisible((visible) => !visible)}
                  >
                    <Icon name="eye" size={18} />
                  </button>
                </div>
              </div>

              <div className="au-field">
                <label className="au-label" htmlFor="au-pwd2">确认密码</label>
                <div className="au-input-wrap">
                  <input
                    id="au-pwd2"
                    className="au-input"
                    type={pwd2Visible ? "text" : "password"}
                    name="confirm-password"
                    placeholder="再输入一次密码"
                    autoComplete="new-password"
                    value={password2}
                    onChange={(event) => setPassword2(event.target.value)}
                  />
                  <button
                    type="button"
                    className={`au-eye ${pwd2Visible ? "on" : ""}`.trim()}
                    aria-label={pwd2Visible ? "隐藏密码" : "显示密码"}
                    onClick={() => setPwd2Visible((visible) => !visible)}
                  >
                    <Icon name="eye" size={18} />
                  </button>
                </div>
              </div>

              <div className="au-field">
                <label className="au-label" htmlFor="au-code">邮箱验证码</label>
                <div className="au-code-row">
                  <input
                    id="au-code"
                    className="au-input"
                    type="text"
                    name="code"
                    placeholder="6 位数字"
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <button type="button" className="m-btn m-btn--soft au-code-btn" disabled={sending || countdown > 0} onClick={() => void sendCode()}>
                    {countdown > 0 ? `${countdown}s` : sending ? "发送中…" : "获取验证码"}
                  </button>
                </div>
              </div>

              <label className="au-check au-check--agree">
                <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
                <span>
                  我已阅读并同意
                  <button type="button" className="au-link" onClick={openDoc("privacy")}>《隐私政策》</button>
                  与
                  <button type="button" className="au-link" onClick={openDoc("terms")}>《用户条款》</button>
                </span>
              </label>
            </>
          ) : null}

          {mode === "verify" ? (
            <>
              <div className="au-field">
                <label className="au-label" htmlFor="au-reset-email">注册邮箱</label>
                <input
                  id="au-reset-email"
                  className="au-input"
                  type="email"
                  name="reset-email"
                  placeholder="你注册时使用的邮箱"
                  autoComplete="email"
                  autoCapitalize="none"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <p className="au-tip">重置链接 10 分钟内有效，最多可打开 3 次；未收到请检查垃圾邮件。</p>
            </>
          ) : null}

          {inlineError ? <p className="au-error" role="alert">{inlineError}</p> : null}

          <button type="submit" className="m-btn m-btn--primary m-btn--block au-primary" disabled={busy || resetSending}>
            {primaryText}
          </button>
        </form>

        {mode === "verify" ? (
          <div className="au-links">
            <button type="button" className="au-link" onClick={() => switchMode("login")}>返回登录</button>
          </div>
        ) : (
          <div className="au-links">
            <button type="button" className="au-link" onClick={() => switchMode("verify")}>忘记密码</button>
            <i className="au-links-dot" aria-hidden="true" />
            <button type="button" className="au-link" onClick={() => setCodeLoginOpen(true)}>邮箱验证码登录</button>
            <i className="au-links-dot" aria-hidden="true" />
            <button type="button" className="au-link" onClick={() => setDocOpen("terms")}>用户协议</button>
          </div>
        )}

        {appInfo && !appInfo.altchaConfigured ? (
          <p className="au-warn">本机的安全校验组件未就绪，登录可能失败。请更新到最新版本后重试。</p>
        ) : null}

        <p className="au-note">请妥善保管账号与密码，不要与他人共享。</p>
      </div>

      <Confirm
        open={agreePrompt}
        title="同意隐私政策与用户条款"
        confirmText="同意并继续"
        onCancel={() => {
          setAgreePrompt(false);
          setPendingAction(null);
        }}
        onConfirm={confirmAgreement}
      >
        <p className="au-confirm-text">
          继续即表示你已阅读并同意《隐私政策》与《用户条款》，我们只会按照上述文件说明的方式收集与使用信息。
        </p>
      </Confirm>

      <Sheet
        open={docOpen !== null}
        title={docOpen === "privacy" ? "隐私政策" : "用户条款"}
        onClose={() => setDocOpen(null)}
        footer={
          <button
            type="button"
            className="m-btn m-btn--soft m-btn--block"
            onClick={() => void openExternal(`${SITE}/${docOpen === "privacy" ? "privacy" : "terms"}`)}
          >
            在浏览器查看完整版本
          </button>
        }
      >
        {docOpen === "privacy" ? (
          <div className="au-doc">
            <p>我们只在你同意后发起网络请求，并按最小必要原则收集信息。</p>
            <ul>
              <li>账号信息：用户名、邮箱、密码（加密存储）。</li>
              <li>内容信息：你发布的帖子、评论与上传的图片。</li>
              <li>设备信息：仅用于崩溃排查与版本更新，不含通讯录等隐私数据。</li>
            </ul>
            <p>你可以随时在「我的 · 账号设置」中修改资料或申请注销账号。</p>
          </div>
        ) : (
          <div className="au-doc">
            <p>使用妖精论坛即表示你愿意遵守社区约定：</p>
            <ul>
              <li>友善交流，不人身攻击、不恶意引战。</li>
              <li>不发布违法违规、广告与侵权内容。</li>
              <li>尊重他人隐私，不泄露他人个人信息。</li>
            </ul>
            <p>违规内容会被删除，情节严重者将封禁账号。</p>
          </div>
        )}
      </Sheet>

      <Sheet
        open={codeLoginOpen}
        title="邮箱验证码登录"
        onClose={() => setCodeLoginOpen(false)}
        footer={
          <button type="button" className="m-btn m-btn--primary m-btn--block" onClick={() => switchMode("verify")}>
            用邮箱找回密码
          </button>
        }
      >
        <div className="au-doc">
          <p>当前版本仅支持账号密码登录；邮箱验证码登录会在后续版本开放。</p>
          <p>忘记密码时，可以用注册邮箱接收重置链接后重新设置。</p>
        </div>
      </Sheet>
    </Screen>
  );
}
