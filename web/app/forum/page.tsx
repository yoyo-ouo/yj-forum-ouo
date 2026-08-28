"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import Header from "@/components/Header";
import { postApi, Post } from "@/lib/api";

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

const TABS = [
  { key: "all", label: "全部" },
  { key: "general", label: "综合" },
  { key: "talk", label: "闲聊" },
  { key: "question", label: "求助" },
  { key: "share", label: "分享" },
  { key: "creative", label: "创作" },
];

export default function ForumPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const pageRef = useRef(1);

  const load = async (cat: string, pageNo: number, append: boolean) => {
    setLoading(true);
    try {
      const r = await postApi.list(pageNo, 20, cat === "all" ? "" : cat);
      setPosts((prev) => (append ? [...prev, ...(r.posts || [])] : r.posts || []));
      setHasMore((r.posts || []).length >= 20);
    } catch {
      if (!append) setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    pageRef.current = 1;
    load(category, 1, false);
  }, [category]);

  const loadMore = () => {
    pageRef.current += 1;
    load(category, pageRef.current, true);
  };

  return (
    <>
      <Header />
      <div className="forum-container">
        <div className="forum-header">
          <h1 className="forum-title">妖精论坛</h1>
          <p className="forum-subtitle">分享你的想法与故事</p>
          <Link href="/post/create" className="forum-create-btn">
            <i className="fa fa-pencil"></i> 发布帖子
          </Link>
        </div>

        <div className="forum-category-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`forum-tab ${category === t.key ? "active" : ""}`} data-category={t.key} onClick={() => setCategory(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="forum-post-list" id="forum-post-list">
          {loading && pageRef.current === 1 ? (
            <div className="forum-loading">加载中...</div>
          ) : posts.length === 0 ? (
            <div className="forum-loading">暂无帖子</div>
          ) : (
            posts.map((p) => (
              <Link className="post-card" href={`/post/${p.id}`} key={p.id}>
                <div className="post-card-avatar-wrap">
                  <img className="post-card-avatar" src={p.user_avatar} alt="" loading="lazy" />
                </div>
                <div className="post-card-body">
                  <div className="post-card-meta">
                    <span className="post-card-category">{CATEGORY_LABELS[p.category] || p.category || "综合"}</span>
                    <span className="post-card-author">{p.user_name}</span>
                    <span className="post-card-time">{timeAgo(p.created_at)}</span>
                  </div>
                  <h3 className="post-card-title">{p.title}</h3>
                  <p className="post-card-summary">{p.summary?.replace(/\n/g, " ")}</p>
                  <div className="post-card-footer">
                    <span className="post-card-views"><i className="fa fa-eye"></i> {p.views}</span>
                    <span className="post-card-likes"><i className="fa fa-heart"></i> {p.likes}</span>
                    <span className="post-card-comments"><i className="fa fa-comment-o"></i> 评论</span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>

        {hasMore && (
          <div className="forum-load-more" id="forum-load-more">
            <button onClick={loadMore} disabled={loading}>{loading ? "加载中..." : "加载更多"}</button>
          </div>
        )}
      </div>
    </>
  );
}
