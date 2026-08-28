"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import PostCard from "@/components/PostCard";
import FollowListModal from "@/components/FollowListModal";
import { ProfilePrefixBadge } from "@/components/PrefixBadge";
import { useToast } from "@/components/Toast";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { userApi, postApi, User, Post, UserBrief, ApiException } from "@/lib/api";
import { useStore } from "@/lib/store";

export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user: me, userId, refreshUser } = useStore();
  const { toast } = useToast();
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
      setIsSelf(!!r.is_self || userId === id);
      const p = await userApi.posts(id, 1, 20);
      setPosts(p.posts || []);
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "用户不存在", "error");
    } finally {
      setLoading(false);
    }
  }, [id, userId, toast]);

  useEffect(() => { load(); }, [load]);

  const toggleFollow = async () => {
    if (!me) return router.push("/auth");
    try {
      const r = await userApi.follow(id);
      setIsFollowing(r.following);
    } catch (e: any) {
      toast(e.message, "error");
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
      toast("验证码已发送至你的邮箱，请在用户资料中填写", "success");
    } catch (e: any) {
      toast(e.message, "error");
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
      toast(e.message, "error");
    }
  };

  const onToggleFollowInList = async (u: UserBrief) => {
    try {
      await userApi.follow(u.id);
      const r = await userApi.following(id);
      setFollowUsers(r.users || []);
    } catch { /* 忽略 */ }
  };

  if (loading) return <div className="loading-text" style={{ padding: 40 }}>加载中...</div>;
  if (!profile) return <div className="loading-text" style={{ padding: 40 }}>用户不存在</div>;

  const vipIcon = profile.vip && profile.vip !== "0" ? (
    <span className="user-vip-icon" style={{ display: "inline-flex" }}>
      <i className="fa fa-diamond" style={{ color: "#f59e0b", fontSize: 18 }}></i>
    </span>
  ) : null;

  return (
    <>
      <div className="user-profile-page">
        <div className="user-profile-card">
          <div className="user-profile-avatar-wrapper">
            <div className="user-profile-avatar">
              <UserAvatar src={profile.avatar} alt="用户头像" imgId="user-profile-avatar-img" fallbackClassName="avatar-fallback avatar-fallback-lg" />
            </div>
            <ProfilePrefixBadge prefix={profile.prefix} />
          </div>
          <div className="user-profile-info">
            <h2>
              <div id="user-profile-name" className="user-name-clickable Username" title="点击查看详情" onClick={isSelf ? updateProfile : undefined}>
                {profile.name}
              </div>
              {vipIcon}
              {profile.email_verified === 1 && (
                <span id="user-profile-email-verified" className="email-verified-badge">
                  <i className="fa fa-check-circle"></i> 已验证
                </span>
              )}
            </h2>
            <p className="user-profile-intro" id="user-profile-intro">{profile.intro || "这个人很懒，什么都没留下~"}</p>
            <div className="user-profile-meta">
              <span className="user-meta-item" id="user-profile-gender">
                <i className="fa fa-user"></i> {profile.gender === 1 ? "男" : profile.gender === 2 ? "女" : "保密"}
              </span>
              <span className="user-meta-item" id="user-profile-age">
                <i className="fa fa-birthday-cake"></i> {profile.age || "保密"}
              </span>
              {isSelf && profile.email_verified === 0 && (
                <button type="button" className="user-meta-item user-meta-clickable email-verify-btn" id="user-profile-verify-email" onClick={sendVerifyEmail}>
                  <i className="fa fa-envelope"></i> 验证邮箱
                </button>
              )}
            </div>
          </div>
          <div className="user-profile-stats">
            <div className="stat-item">
              <span className="stat-number" id="user-post-count">{stats?.post_count || 0}</span>
              <span className="stat-label">帖子</span>
            </div>
            <div className="stat-item">
              <span className="stat-number" id="user-total-likes">{stats?.total_likes || 0}</span>
              <span className="stat-label">获赞</span>
            </div>
            <div className="stat-item">
              <span className="stat-number" id="user-total-views">{stats?.total_views || 0}</span>
              <span className="stat-label">浏览</span>
            </div>
            <div className="stat-item stat-item-clickable" onClick={() => openFollowList("following")}>
              <span className="stat-number" id="user-following-count">{followStats?.following_count || 0}</span>
              <span className="stat-label">关注</span>
            </div>
            <div className="stat-item stat-item-clickable" onClick={() => openFollowList("followers")}>
              <span className="stat-number" id="user-follower-count">{followStats?.follower_count || 0}</span>
              <span className="stat-label">粉丝</span>
            </div>
          </div>
          {!isSelf && (
            <button className={`user-follow-btn ${isFollowing ? "following" : ""}`} id="user-follow-btn" onClick={toggleFollow}>
              {isFollowing ? "已关注" : "+ 关注"}
            </button>
          )}
        </div>

        <div className="user-profile-tabs">
          <button className="profile-tab active" data-tab="posts">
            <i className="fa fa-file-text"></i> 帖子列表
          </button>
          <Link href="/post/create" className="profile-tab profile-tab-create">
            <i className="fa fa-pencil"></i> 发布新帖
          </Link>
        </div>

        <div className="user-profile-content">
          <div id="user-posts-list" className="user-posts-list">
            {posts.length === 0 ? (
              <p className="loading-text">还没有发布帖子</p>
            ) : (
              posts.map((p) => <PostCard key={p.id} post={p} showTime={false} />)
            )}
          </div>
        </div>
      </div>

      {showFollowList && (
        <FollowListModal
          title={showFollowList === "following" ? "关注列表" : "粉丝列表"}
          users={followUsers}
          currentUserId={userId}
          onClose={() => setShowFollowList(null)}
          onTabChange={(tab) => openFollowList(tab)}
          onToggleFollow={onToggleFollowInList}
        />
      )}
    </>
  );
}
