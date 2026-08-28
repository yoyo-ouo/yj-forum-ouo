"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Header, { showCenterCard } from "@/components/Header";
import { userApi, postApi, User, Post, UserBrief, ApiException } from "@/lib/api";
import { useStore } from "@/lib/store";

function timeAgo(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "综合", talk: "闲聊", question: "求助", share: "分享", creative: "创作",
};

export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user: me, refreshUser } = useStore();
  const [profile, setProfile] = useState<User | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [followStats, setFollowStats] = useState<any>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isSelf, setIsSelf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showFollowList, setShowFollowList] = useState<null | "following" | "followers">(null);
  const [followUsers, setFollowUsers] = useState<UserBrief[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await userApi.profile(id);
      setProfile(r.user);
      setStats(r.stats);
      setFollowStats(r.follow_stats);
      setIsFollowing(!!r.is_following);
      setIsSelf(!!r.is_self);
      const p = await userApi.posts(id, 1, 20);
      setPosts(p.posts || []);
    } catch (e) {
      showCenterCard(`<p>${e instanceof ApiException ? e.message : "用户不存在"}</p>`);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const toggleFollow = async () => {
    if (!me) return router.push("/login");
    try {
      const r = await userApi.follow(id);
      setIsFollowing(r.following);
    } catch (e: any) {
      showCenterCard(`<p>${e.message}</p>`);
    }
  };

  const openFollowList = async (kind: "following" | "followers") => {
    setShowFollowList(kind);
    try {
      const r = kind === "following" ? await userApi.following(id) : await userApi.followers(id);
      setFollowUsers(r.users || []);
    } catch { setFollowUsers([]); }
  };

  const sendVerifyEmail = async () => {
    try {
      await userApi.verifyEmail();
      showCenterCard(`<p style="text-align:center">验证码已发送至你的邮箱，请在用户资料中填写</p>`);
    } catch (e: any) {
      showCenterCard(`<p>${e.message}</p>`);
    }
  };

  const updateProfile = async () => {
    const intro = window.prompt("修改个性签名", profile?.intro || "");
    if (intro === null) return;
    try {
      await userApi.updateMe({ intro });
      await refreshUser();
      load();
    } catch (e: any) {
      showCenterCard(`<p>${e.message}</p>`);
    }
  };

  if (loading) return <><Header /><div className="forum-loading" style={{ padding: 40 }}>加载中...</div></>;
  if (!profile) return <><Header /><div className="forum-loading" style={{ padding: 40 }}>用户不存在</div></>;

  return (
    <>
      <Header />
      <div className="forum-container" style={{ maxWidth: 900 }}>
        <div className="user-profile-card">
          <div className="user-profile-header">
            <img className="user-profile-avatar" src={profile.avatar} alt="" />
            <div className="user-profile-info">
              <h1 className="user-profile-name">
                {profile.name}
                {profile.vip === "1" && <span className="vip-badge"><i className="fa fa-crown"></i> VIP</span>}
                {profile.prefix && <span className="user-prefix">{profile.prefix}</span>}
              </h1>
              <p className="user-profile-intro">{profile.intro || "这个人很懒，什么都没留下~"}</p>
              {profile.email_verified === 0 && !isSelf && (
                <p className="user-verify-hint"><i className="fa fa-exclamation-circle"></i> 该用户邮箱未验证</p>
              )}
            </div>
            <div className="user-profile-actions">
              {isSelf ? (
                <button className="submit-button" onClick={updateProfile}><i className="fa fa-pencil"></i> 编辑资料</button>
              ) : (
                <button className={`submit-button ${isFollowing ? "secondary" : ""}`} onClick={toggleFollow}>
                  {isFollowing ? "已关注" : "+ 关注"}
                </button>
              )}
            </div>
          </div>

          <div className="user-stats-row">
            <div className="stat-item"><span className="stat-num">{stats?.post_count || 0}</span><span className="stat-label">帖子</span></div>
            <div className="stat-item"><span className="stat-num">{stats?.total_likes || 0}</span><span className="stat-label">获赞</span></div>
            <div className="stat-item"><span className="stat-num">{stats?.total_views || 0}</span><span className="stat-label">浏览</span></div>
            <div className="stat-item clickable" onClick={() => openFollowList("following")}>
              <span className="stat-num">{followStats?.following_count || 0}</span><span className="stat-label">关注</span>
            </div>
            <div className="stat-item clickable" onClick={() => openFollowList("followers")}>
              <span className="stat-num">{followStats?.follower_count || 0}</span><span className="stat-label">粉丝</span>
            </div>
          </div>

          {isSelf && profile.email_verified === 0 && (
            <div className="user-verify-bar">
              <span>邮箱未验证</span>
              <button className="submit-button secondary" onClick={sendVerifyEmail}>发送验证邮件</button>
            </div>
          )}
        </div>

        <section className="user-posts-section">
          <h2 className="comments-title"><i className="fa fa-file-text-o"></i> TA 的帖子</h2>
          <div className="forum-post-list">
            {posts.length === 0 ? (
              <div className="forum-loading">还没有发布帖子</div>
            ) : (
              posts.map((p) => (
                <Link className="post-card" href={`/post/${p.id}`} key={p.id}>
                  <div className="post-card-body">
                    <div className="post-card-meta">
                      <span className="post-card-category">{CATEGORY_LABELS[p.category] || p.category || "综合"}</span>
                    </div>
                    <h3 className="post-card-title">{p.title}</h3>
                    <p className="post-card-summary">{p.summary?.replace(/\n/g, " ")}</p>
                    <div className="post-card-footer">
                      <span className="post-card-views"><i className="fa fa-eye"></i> {p.views}</span>
                      <span className="post-card-likes"><i className="fa fa-heart"></i> {p.likes}</span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      {showFollowList && (
        <div id="follow-modal" className="donate-modal" style={{ display: "flex" }}>
          <div className="donate-overlay" onClick={() => setShowFollowList(null)}></div>
          <div className="donate-card" style={{ maxWidth: 420 }}>
            <button className="donate-close" onClick={() => setShowFollowList(null)}>&times;</button>
            <h3 className="donate-title">{showFollowList === "following" ? "关注列表" : "粉丝列表"}</h3>
            <div className="follow-list" style={{ maxHeight: 300, overflowY: "auto", marginTop: 12 }}>
              {followUsers.length === 0 ? (
                <p style={{ textAlign: "center", color: "#999" }}>暂无数据</p>
              ) : (
                followUsers.map((u) => (
                  <Link className="follow-item" href={`/users/${u.id}`} key={u.id} onClick={() => setShowFollowList(null)}>
                    <img className="comment-avatar" src={u.avatar} alt="" />
                    <span>{u.name}</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
