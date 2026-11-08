import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { Avatar, Confirm, TopBar } from "../components/ui";

export function MeScreen() {
  const user = useApp((s) => s.user);
  const theme = useApp((s) => s.theme);
  const refreshUser = useApp((s) => s.refreshUser);
  const logout = useApp((s) => s.logout);
  const appInfo = useApp((s) => s.appInfo);
  const show = useApp((s) => s.showToast);
  const { push } = useNav();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const profile = useQuery({ queryKey: ["profile", user?.id], queryFn: () => api.user(user!.id), enabled: Boolean(user?.id) });

  if (!user) {
    return (
      <div className="screen">
        <TopBar title="我的" />
        <div className="empty" style={{ paddingTop: 80 }}>
          <div className="empty-mark">◐</div>
          <p>登录后查看你的帖子、收藏与角色设定</p>
          <button className="btn primary" onClick={() => push("auth")}>登录 / 注册</button>
        </div>
      </div>
    );
  }

  const stats = profile.data?.stats;
  const follow = profile.data?.follow_stats;

  const signIn = async () => {
    try {
      const res = await api.signIn();
      show(`签到成功，灵力 +${res?.data?.spirit ?? 5}`);
      void refreshUser();
    } catch (error) {
      show(error instanceof Error ? error.message : "签到失败", "error");
    }
  };

  const cell = (label: string, value: string | undefined, onClick: () => void) => (
    <div className="me-cell" onClick={onClick}>
      <span>{label}</span>
      {value ? <span className="value">{value}</span> : null}
      <span className="chev">›</span>
    </div>
  );

  return (
    <div className="screen">
      <TopBar title="我的" actions={<button className="icon-btn" onClick={() => push("settings")}>⚙</button>} />
      <div className="me-card">
        <div className="me-top">
          <Avatar src={user.avatar} name={user.name} size={56} />
          <div style={{ flex: 1 }}>
            <div className="me-name">{user.name}</div>
            <div className="me-sub">{profile.data?.guild?.name || "妖精论坛"} · 灵力 {user.spirit ?? 0}</div>
          </div>
          <button className="btn sm ghost" onClick={() => void signIn()}>签到</button>
        </div>
        <div className="me-grid">
          <div><b>{stats?.post_count ?? 0}</b><span>帖子</span></div>
          <div><b>{stats?.total_likes ?? 0}</b><span>获赞</span></div>
          <div><b>{follow?.following_count ?? 0}</b><span>关注</span></div>
          <div><b>{follow?.follower_count ?? 0}</b><span>粉丝</span></div>
        </div>
      </div>

      <div className="me-group">
        <div className="me-group-title">内容</div>
        {cell("我的帖子", String(stats?.post_count ?? ""), () => push("user", { id: user.id }))}
        {cell("我的收藏", "", () => push("user", { id: user.id, tab: "favorites" }))}
        {cell("我的评论", "", () => push("user", { id: user.id, tab: "comments" }))}
        {cell("角色设定", "", () => push("character"))}
      </div>

      <div className="me-group">
        <div className="me-group-title">设置</div>
        {cell("账号安全", "", () => push("account"))}
        {cell("外观主题", theme === "auto" ? "跟随系统" : theme === "night" ? "夜间" : "日间", () => push("settings"))}
        {cell("年制换算", "", () => push("year"))}
        {cell("彩蛋", "", () => push("settings"))}
        {cell("更新日志", "", () => push("changelog"))}
        {cell("版本更新", appInfo?.versionName || "2.0.0", () => push("version"))}
      </div>

      <div className="me-group">
        <div className="me-group-title">关于</div>
        {cell("隐私政策", "", () => push("settings"))}
        {cell("指南", "", () => push("guides"))}
        {cell("反馈", "", () => push("feedback"))}
        <div className="me-cell" onClick={() => setConfirmLogout(true)}><span style={{ color: "#c22f2f" }}>退出登录</span><span className="chev">›</span></div>
      </div>
      <div className="me-footer">妖精论坛（二创） · 非商业同人项目 · {appInfo?.versionName || "2.0.0"}</div>

      <Confirm
        open={confirmLogout}
        title="退出登录？"
        confirmText="退出"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => { setConfirmLogout(false); await logout(); useApp.getState().showToast("已退出登录"); }}
      >
        退出后需要重新登录才能发帖与评论。
      </Confirm>
    </div>
  );
}
