import React, { useEffect, useRef, useState } from "react";
import { NavProvider, useNav, type TabKey } from "./lib/nav";
import { useApp, PRIVACY_VERSION } from "./lib/store";
import { bus } from "./lib/bus";
import { handleBack, registerBackHandler } from "./lib/back";
import { checkUpdate, onSessionExpired, onUpdateProgress, sse } from "./lib/native";
import { ToastHost, TabIcon } from "./components/ui";
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

function ScreenHost() {
  const { top } = useNav();
  switch (top.name) {
    case "feed": return <FeedScreen />;
    case "post": return <PostScreen id={top.params?.id} />;
    case "compose": return <ComposeScreen />;
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
    default: return <FeedScreen />;
  }
}

function TabBar() {
  const { tab, switchTab, push } = useNav();
  const unread = useApp((s) => s.unread);
  const total = unread.likes + unread.comments + unread.system + unread.chat;
  const item = (key: TabKey, label: string) => (
    <button className={`tabbar-item ${tab === key ? "on" : ""}`} onClick={() => switchTab(key)}>
      <TabIcon name={key} />
      <span>{label}</span>
      {key === "messages" && total > 0 ? <i className="tabbar-badge">{total > 99 ? "99+" : total}</i> : null}
    </button>
  );
  return (
    <nav className="tabbar">
      {item("square", "广场")}
      {item("world", "世界")}
      <button className="tabbar-compose" aria-label="发帖" onClick={() => push("compose")}>+</button>
      {item("messages", "消息")}
      {item("me", "我的")}
    </nav>
  );
}

function UpdatePrompt({ manifest, onClose, onOpen }: { manifest: UpdateManifest; onClose: () => void; onOpen: () => void }) {
  useEffect(() => registerBackHandler(() => { onClose(); return true; }), [onClose]);
  const release = manifest.release;
  if (!release) return null;
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()} style={{ maxHeight: "70dvh" }}>
        <div className="sheet-head">
          <strong>发现新版本 {release.version}</strong>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="sheet-body">
          <div className="row between small muted">
            <span>{release.size ? `${(release.size / 1024 / 1024).toFixed(1)} MB` : "安装包"}</span>
            <span>{manifest.mandatory ? "重要更新" : "可选更新"}</span>
          </div>
          <div className="update-notes">
            {(release.notes || ["修复问题与体验优化"]).slice(0, 12).map((line, index) => <p key={index}>{line}</p>)}
          </div>
        </div>
        <div className="sheet-foot row">
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>稍后</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={onOpen}>查看更新</button>
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
  const { push } = useNav();
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
    void onUpdateProgress((progress) => bus.emit("updateProgress", progress));
    return () => { off(); };
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
      <div className="boot-screen">
        <div className="center">
          <div className="boot-logo">妖</div>
          <div className="muted small">正在打开妖精论坛…</div>
        </div>
      </div>
    );
  }

  if (!consented) {
    return (
      <div className="privacy-gate">
        <div className="boot-logo">妖</div>
        <h1>欢迎来到妖精论坛</h1>
        <p>在开始之前，请阅读并同意《隐私政策》与《用户条款》。我们只在你同意后才会发起网络请求。</p>
        <p className="small muted">当前隐私政策版本：{PRIVACY_VERSION}</p>
        <button className="btn primary block" onClick={() => void consent()}>同意并继续</button>
        <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => push("settings")}>查看隐私说明</button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <ScreenHost />
      </main>
      <TabBar />
      <ToastHost />
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
