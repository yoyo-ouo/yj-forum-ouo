import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { AppBar, Avatar, Cell, Confirm, IconButton, Screen } from "../components/mobile";
import { Icon, type IconName } from "../components/icons";

const THEME_LABEL: Record<string, string> = { auto: "跟随系统", day: "日间", night: "夜间", national: "国庆红金" };

/** 与服务端签到日界一致的上海日期（YYYY-MM-DD） */
function shanghaiDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

interface QuickItem {
  key: string;
  icon: IconName;
  label: string;
  onClick: () => void;
}

export function MeScreen() {
  const user = useApp((s) => s.user);
  const theme = useApp((s) => s.theme);
  const yearMode = useApp((s) => s.yearMode);
  const appInfo = useApp((s) => s.appInfo);
  const refreshUser = useApp((s) => s.refreshUser);
  const logout = useApp((s) => s.logout);
  const show = useApp((s) => s.showToast);
  const { push } = useNav();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signedToday, setSignedToday] = useState(false);
  const profile = useQuery({ queryKey: ["profile", user?.id], queryFn: () => api.user(user!.id), enabled: Boolean(user?.id) });

  // 初始签到态：last_sign_in 与服务端同一日界（Asia/Shanghai）比对
  useEffect(() => {
    const last = user?.last_sign_in;
    setSignedToday(Boolean(last && last === shanghaiDate()));
  }, [user?.last_sign_in]);

  const signIn = async () => {
    if (signing || signedToday) return;
    setSigning(true);
    try {
      const res = await api.signIn();
      const spirit = res?.data?.spirit;
      setSignedToday(true);
      show(typeof spirit === "number" ? `签到成功，灵力 +${spirit}` : "签到成功");
      void refreshUser();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSignedToday(true);
        show("今日已签到");
      } else {
        show(error instanceof Error ? error.message : "签到失败", "error");
      }
    } finally {
      setSigning(false);
    }
  };

  const appbar = (
    <AppBar
      title="我的"
      actions={<IconButton icon="settings" label="设置" onClick={() => push("settings")} />}
    />
  );

  /* ------------------------------ 未登录 ------------------------------ */
  if (!user) {
    return (
      <Screen appbar={appbar}>
        <div className="m-card me-welcome">
          <div className="me-welcome-logo" aria-hidden="true">妖</div>
          <div className="me-welcome-title">欢迎来到妖精论坛</div>
          <p className="me-welcome-text">登录后可以发帖、收藏和关注</p>
          <button className="m-btn m-btn--primary m-btn--block" onClick={() => push("auth")}>
            登录 / 注册
          </button>
          <p className="me-welcome-hint">未登录也可以浏览广场与世界频道</p>
        </div>
        <div className="me-footer">妖精论坛（二创） · 非商业同人项目</div>
      </Screen>
    );
  }

  const stats = profile.data?.stats;
  const follow = profile.data?.follow_stats;
  const guild = profile.data?.guild;

  const statItems: Array<{ key: string; label: string; value: number | string; onClick: () => void }> = [
    { key: "posts", label: "帖子", value: stats?.post_count ?? 0, onClick: () => push("user", { id: user.id, tab: "posts" }) },
    { key: "likes", label: "获赞", value: stats?.total_likes ?? 0, onClick: () => push("likes") },
    { key: "following", label: "关注", value: follow?.following_count ?? 0, onClick: () => push("follows", { id: user.id, tab: "following" }) },
    { key: "followers", label: "粉丝", value: follow?.follower_count ?? 0, onClick: () => push("follows", { id: user.id, tab: "followers" }) },
  ];

  const quickItems: QuickItem[] = [
    { key: "posts", icon: "edit", label: "我的帖子", onClick: () => push("user", { id: user.id, tab: "posts" }) },
    { key: "favorites", icon: "bookmark", label: "收藏", onClick: () => push("user", { id: user.id, tab: "favorites" }) },
    { key: "comments", icon: "comment", label: "评论", onClick: () => push("user", { id: user.id, tab: "comments" }) },
    { key: "drafts", icon: "clock", label: "草稿箱", onClick: () => push("drafts") },
    { key: "profile-edit", icon: "crop", label: "编辑资料", onClick: () => push("profile-edit") },
    { key: "likes", icon: "heart", label: "谁赞了我", onClick: () => push("likes") },
    { key: "character", icon: "sparkle", label: "角色设定", onClick: () => push("character") },
  ];

  return (
    <>
      <Screen appbar={appbar}>
        {/* 资料卡 */}
        <div className="m-card me-profile">
          <div className="me-profile-top">
            <button
              type="button"
              className="me-avatar-btn"
              aria-label="编辑资料"
              onClick={() => push("profile-edit")}
            >
              <Avatar src={user.avatar} name={user.name} size={64} />
            </button>
            <div className="me-profile-id">
              <div className="me-name-row">
                <button type="button" className="me-name me-name-btn m-ellipsis" onClick={() => push("profile-edit")}>
                  {user.name}
                </button>
                <button
                  type="button"
                  className={`m-btn m-btn--sm m-btn--pill me-sign ${signedToday ? "is-done m-btn--soft" : "m-btn--primary"}`}
                  disabled={signing || signedToday}
                  aria-label={signedToday ? "今日已签到" : "签到"}
                  onClick={() => void signIn()}
                >
                  {signedToday ? <><Icon name="check" size={13} />已签到</> : signing ? "签到中" : "签到"}
                </button>
              </div>
              <div className="me-meta">
                {guild?.name ? (
                  <button
                    type="button"
                    className="me-guild"
                    aria-label={`会馆 ${guild.name}`}
                    onClick={() => guild.slug && push("guild", { slug: guild.slug })}
                  >
                    <Icon name="home" size={12} />
                    <span>{guild.name}</span>
                  </button>
                ) : (
                  <span className="me-guild me-guild--none">
                    <Icon name="home" size={12} />
                    <span>未加入会馆</span>
                  </span>
                )}
                <span className="me-spirit">灵力 {user.spirit ?? 0}</span>
              </div>
            </div>
          </div>
          {user.intro ? <p className="me-intro m-clamp2">{user.intro}</p> : null}
          <div className="me-stats">
            {statItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className="me-stat"
                aria-label={`${item.label} ${item.value}`}
                onClick={item.onClick}
              >
                <span className="me-stat-num">{item.value}</span>
                <span className="me-stat-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 快捷宫格 */}
        <div className="m-card me-quick">
          {quickItems.map((item) => (
            <button key={item.key} type="button" className="me-quick-item" onClick={item.onClick}>
              <span className="me-quick-icon"><Icon name={item.icon} size={19} /></span>
              <span className="me-quick-label">{item.label}</span>
            </button>
          ))}
        </div>

        {/* 外观 */}
        <div className="m-section-title">外观</div>
        <div className="m-list">
          <Cell icon="sun" label="主题" value={THEME_LABEL[theme] ?? "跟随系统"} onClick={() => push("settings")} />
          <Cell icon="clock" label="年制" value={yearMode === "ce" ? "公元年" : "无限年"} onClick={() => push("settings")} />
        </div>

        {/* 关于 */}
        <div className="m-section-title">关于</div>
        <div className="m-list">
          <Cell icon="download" label="版本更新" value={appInfo?.versionName || "2.0.0"} onClick={() => push("version")} />
          <Cell icon="list" label="更新日志" onClick={() => push("changelog")} />
          <Cell icon="shield" label="隐私说明" onClick={() => push("settings", { privacy: 1 })} />
          <Cell icon="compass" label="使用指南" onClick={() => push("guides")} />
          <Cell icon="mail" label="意见反馈" onClick={() => push("feedback")} />
        </div>

        {/* 退出登录 */}
        <div className="m-list me-logout">
          <Cell icon="logout" label="退出登录" danger chevron={false} onClick={() => setConfirmLogout(true)} />
        </div>

        <div className="me-footer">
          妖精论坛（二创） · 非商业同人项目{appInfo?.versionName ? ` · v${appInfo.versionName}` : ""}
        </div>
      </Screen>

      <Confirm
        open={confirmLogout}
        title="退出登录？"
        confirmText="退出"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          void logout().then(() => show("已退出登录"));
        }}
      >
        退出后需要重新登录才能发帖与评论。
      </Confirm>
    </>
  );
}
