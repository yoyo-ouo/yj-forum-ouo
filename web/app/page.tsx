"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import PostCard from "@/components/PostCard";
import { ListLoading, ListEmpty } from "@/components/ui/ListState";
import { postApi, userApi, Post } from "@/lib/api";
import { useStore } from "@/lib/store";

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
              <ListLoading />
            ) : posts.length === 0 ? (
              <ListEmpty />
            ) : (
              posts.map((p) => <PostCard key={p.id} post={p} />)
            )}
          </div>
        </section>
      </div>
    </>
  );
}
