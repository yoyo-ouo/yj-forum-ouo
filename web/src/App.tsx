import React, { useEffect, useRef, useState } from "react";
import { NavProvider, useNav } from "./lib/nav";
import { useApp, PRIVACY_VERSION } from "./lib/store";
import { bus } from "./lib/bus";
import { handleBack, registerBackHandler } from "./lib/back";
import { checkUpdate, onSessionExpired, onUpdateProgress, onVersionTooLow, sse } from "./lib/native";
import { ToastHost, TabBar } from "./components/mobile";
import { CaptchaErrorSheet } from "./components/CaptchaErrorSheet";
import { Icon } from "./components/icons";
import type { UpdateManifest } from "./lib/types";

import { FeedScreen } from "./screens/feed";
import { PostScreen } from "./screens/post";
import { ComposeScreen } from "./screens/compose";
import { SearchScreen } from "./screens/search";
import { UserScreen } from "./screens/user";
import { MeScreen } from "./screens/me";
import { VersionScreen } from "./screens/version";
import { AuthScreen } from "./screens/auth";
import { SettingsScreen, AccountScreen } from "./screens/settings";
import { GuildsScreen, GuildDetailScreen, ArticleScreen } from "./screens/guilds";
import { WorldScreen } from "./screens/world";
import { MessagesScreen } from "./screens/messages";
import { CharacterScreen, CharacterDetailScreen } from "./screens/character";
import { GuideScreen, GuideDetailScreen, FeedbackScreen, FeedbackDetailScreen, ChangelogScreen, YearConverterScreen } from "./screens/misc";
import { FollowsScreen } from "./screens/follows";
import { LikesScreen } from "./screens/likes";
import { ProfileEditScreen } from "./screens/profile-edit";
import { EmailScreen, AccountDeleteScreen, DraftsScreen } from "./screens/account";
import { CharacterEditorScreen } from "./screens/editor";

function ScreenHost() {
  const { top } = useNav();
  switch (top.name) {
    case "feed": return <FeedScreen />;
    case "post": return <PostScreen id={top.params?.id} />;
    case "compose": return <ComposeScreen draftId={top.params?.draft} />;
    case "search": return <SearchScreen initial={top.params?.keyword || ""} />;
    case "user": return <UserScreen id={top.params?.id} initialTab={(top.params?.tab || "posts") as any} />;
    case "me": return <MeScreen />;
    case "version": return <VersionScreen />;
    case "auth": return <AuthScreen />;
    case "settings": return <SettingsScreen />;
    case "account": return <AccountScreen />;
    case "guilds": return <GuildsScreen />;
    case "guild": return <GuildDetailScreen slug={top.params?.slug} />;
    case "article": return <ArticleScreen id={top.params?.id} />;
    case "world": return <WorldScreen />;
    case "messages": return <MessagesScreen />;
    case "character": return <CharacterScreen />;
    case "character-detail": return <CharacterDetailScreen id={top.params?.id} />;
    case "guides": return <GuideScreen />;
    case "guide": return <GuideDetailScreen id={top.params?.id} />;
    case "feedback": return <FeedbackScreen />;
    case "feedback-detail": return <FeedbackDetailScreen id={top.params?.id} />;
    case "changelog": return <ChangelogScreen />;
    case "year": return <YearConverterScreen />;
    case "follows": return <FollowsScreen id={top.params?.id} tab={top.params?.tab} />;
    case "likes": return <LikesScreen />;
    case "profile-edit": return <ProfileEditScreen />;
    case "email": return <EmailScreen stage={top.params?.stage} />;
    case "account-delete": return <AccountDeleteScreen />;
    case "drafts": return <DraftsScreen id={top.params?.id} />;
    case "character-editor": return <CharacterEditorScreen id={top.params?.id} />;
    default: return <FeedScreen />;
  }
}

function UpdatePrompt({ manifest, onClose, onOpen }: { manifest: UpdateManifest; onClose: () => void; onOpen: () => void }) {
  useEffect(() => registerBackHandler(() => { onClose(); return true; }), [onClose]);
  const release = manifest.release;
  if (!release) return null;
  return (
    <div className="m-mask" onClick={onClose}>
      <div className="m-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="m-sheet-grip" />
        <div className="m-sheet-head">
          <strong style={{ flex: 1 }}>版本 {release.version} 可用</strong>
          <button className="m-iconbtn" aria-label="关闭" onClick={onClose}><Icon name="close" size={20} /></button>
        </div>
        <div className="m-sheet-body">
          <div className="m-row" style={{ gap: 8, marginBottom: 12 }}>
            <span className="m-pill">{manifest.mandatory ? "重要更新" : "可选更新"}</span>
            <span className="m-meta">{release.size ? `${(release.size / 1024 / 1024).toFixed(1)} MB` : "安装包"}</span>
          </div>
          <div className="m-text" style={{ fontSize: 13.5 }}>
            {(release.notes || ["修复问题与体验优化"]).slice(0, 8).map((line, index) => <p key={index} style={{ margin: "0 0 6px" }}>{line}</p>)}
          </div>
        </div>
        <div className="m-sheet-foot">
          <button className="m-btn m-btn--ghost" onClick={onClose}>稍后</button>
          <button className="m-btn m-btn--primary" onClick={onOpen}>去更新</button>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const booted = useApp((s) => s.booted);
  const consented = useApp((s) => s.consented);
  const boot = useApp((s) => s.boot);
  const consent = useApp((s) => s.consent);
  const appInfo = useApp((s) => s.appInfo);
  const update = useApp((s) => s.update);
  const updateDismissed = useApp((s) => s.updateDismissed);
  const setUpdate = useApp((s) => s.setUpdate);
  const dismissUpdate = useApp((s) => s.dismissUpdate);
  const showToast = useApp((s) => s.showToast);
  const { push, top } = useNav();
  const lastCheck = useRef(0);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    window.__yjBack = handleBack;
    return () => { delete window.__yjBack; };
  }, []);

  useEffect(() => {
    const off = bus.on("sse", (payload) => {
      if (payload?.channel === "messages") {
        void useApp.getState().refreshUser();
      }
    });
    void sse.addListener("sse", (payload) => bus.emit("sse", payload));
    void onSessionExpired(() => {
      useApp.setState({ user: null });
      showToast("登录已过期，请重新登录", "error");
    });
    // 版本过低：原生壳自己会 notify，web 端由 api 层写入同一事件
    void onVersionTooLow(() => bus.emit("versionTooLow", { status: 426 }));
    const offVersion = bus.on("versionTooLow", () => {
      showToast("当前版本过低，请更新 App 后继续", "error");
    });
    void onUpdateProgress((progress) => bus.emit("updateProgress", progress));
    return () => { off(); offVersion(); };
  }, [showToast]);

  useEffect(() => {
    if (!booted || !consented || !appInfo) return;
    const run = async () => {
      if (Date.now() - lastCheck.current < 4 * 60_000) return;
      lastCheck.current = Date.now();
      try {
        const manifest = await checkUpdate(appInfo.versionName);
        if (manifest.available) setUpdate(manifest);
      } catch {
        /* 静默失败，版本页可手动检查 */
      }
    };
    void run();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [booted, consented, appInfo, setUpdate]);

  if (!booted) {
    return (
      <div className="m-boot">
        <div className="m-boot-logo">妖</div>
        <div className="m-boot-name">妖精论坛</div>
        <span className="m-spinner" style={{ marginTop: 18 }} />
      </div>
    );
  }

  if (!consented) {
    return (
      <div className="m-intro">
        <div className="m-intro-glow" />
        <div className="m-intro-inner">
          <div className="m-boot-logo" style={{ margin: "0 0 22px" }}>妖</div>
          <h1>欢迎来到<br />妖精论坛</h1>
          <p>在开始之前，请阅读并同意《隐私政策》与《用户条款》。<br />我们只在你同意后才会发起网络请求。</p>
          <button className="m-btn m-btn--primary m-btn--block" onClick={() => void consent()}>同意并继续</button>
          <button className="m-btn m-btn--ghost m-btn--block" style={{ marginTop: 8 }} onClick={() => push("settings")}>查看隐私说明</button>
          <div className="m-small m-muted" style={{ marginTop: 22, textAlign: "center" }}>隐私政策版本 {PRIVACY_VERSION}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <ScreenHost key={top.key} />
      </main>
      <TabBar />
      <ToastHost />
      <CaptchaErrorSheet />
      {update?.available && !updateDismissed ? (
        <UpdatePrompt
          manifest={update}
          onClose={dismissUpdate}
          onOpen={() => {
            dismissUpdate();
            push("version");
          }}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <NavProvider>
      <Shell />
    </NavProvider>
  );
}
