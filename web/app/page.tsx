"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import { postApi, userApi, Post, ApiException } from "@/lib/api";
import { useStore } from "@/lib/store";

const CATEGORY_LABELS: Record<string, string> = {
  general: "综合", talk: "闲聊", question: "求助", share: "分享", creative: "创作",
};

function timeAgo(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function PostCard({ post }: { post: Post }) {
  const label = CATEGORY_LABELS[post.category] || post.category || "综合";
  return (
    <Link className="post-card" href={`/post/${post.id}`}>
      <div className="post-card-avatar-wrap">
        <img className="post-card-avatar" src={post.user_avatar} alt="" loading="lazy" />
      </div>
      <div className="post-card-body">
        <div className="post-card-meta">
          <span className="post-card-category">{label}</span>
          <span className="post-card-author">{post.user_name}</span>
          <span className="post-card-time">{timeAgo(post.created_at)}</span>
        </div>
        <h3 className="post-card-title">{post.title}</h3>
        <p className="post-card-summary">{post.summary?.replace(/\n/g, " ")}</p>
        <div className="post-card-footer">
          <span className="post-card-views"><i className="fa fa-eye"></i> {post.views}</span>
          <span className="post-card-likes"><i className="fa fa-heart"></i> {post.likes}</span>
          <span className="post-card-comments"><i className="fa fa-comment-o"></i> 评论</span>
        </div>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [favorites, setFavorites] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const { userId } = useStore();

  const loadRandom = useCallback(async () => {
    try {
      const r = await postApi.random();
      setPosts(r.posts || []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFavorites = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await userApi.favorites(userId, 1, 10);
      setFavorites(r.posts || []);
    } catch {
      setFavorites([]);
    }
  }, [userId]);

  useEffect(() => {
    loadRandom();
  }, [loadRandom]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  return (
    <>
      <Header />
      <div className="home-container">
        <section className="home-quick-top">
          <Link className="quick-top-entry" href="/World">
            <div className="quick-top-icon">
              <i className="fa fa-globe"></i>
            </div>
            <div className="quick-top-body">
              <div className="quick-top-name">世界频道</div>
              <div className="quick-top-desc">和小伙伴们一起聊天</div>
            </div>
            <i className="fa fa-chevron-right quick-top-arrow"></i>
          </Link>
        </section>

        <section className="home-hero">
          <div className="home-hero-inner">
            <h1 className="home-hero-title">妖精论坛</h1>
            <p className="home-hero-subtitle">分享你的想法与故事</p>
            <div className="home-hero-actions">
              <Link href="/forum" className="home-hero-btn secondary">
                <i className="fa fa-list"></i> 论坛广场
              </Link>
            </div>
          </div>
        </section>

        {favorites.length > 0 && (
          <section className="home-favorites" id="home-favorites">
            <div className="home-feed-header">
              <h2 className="home-feed-title">
                <i className="fa fa-bookmark"></i> 我的收藏
              </h2>
            </div>
            <div className="home-post-list">
              {favorites.map((p) => <PostCard key={p.id} post={p} />)}
            </div>
          </section>
        )}

        <section className="home-feed">
          <div className="home-feed-header">
            <h2 className="home-feed-title">
              <i className="fa fa-random"></i> 随机推荐
              <span className="home-feed-tag" id="home-feed-tag">随机展示</span>
            </h2>
            <button className="home-refresh-btn" id="home-refresh-btn" onClick={loadRandom}>
              <i className="fa fa-refresh"></i> 换一批
            </button>
          </div>

          <div className="home-post-list" id="home-post-list">
            {loading ? (
              <div className="forum-loading">加载中...</div>
            ) : posts.length === 0 ? (
              <div className="forum-loading">暂无帖子</div>
            ) : (
              posts.map((p) => <PostCard key={p.id} post={p} />)
            )}
          </div>
        </section>
      </div>
    </>
  );
}
