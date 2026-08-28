"use client";

import { useEffect, useState, useRef } from "react";
import Header from "@/components/Header";
import PostCard from "@/components/PostCard";
import { ListLoading, ListEmpty, LoadMoreButton } from "@/components/ui/ListState";
import Link from "next/link";
import { postApi, Post } from "@/lib/api";
import { POST_CATEGORIES } from "@/lib/constants";

const TABS = [{ key: "all", label: "全部" }, ...POST_CATEGORIES];

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
            <ListLoading />
          ) : posts.length === 0 ? (
            <ListEmpty />
          ) : (
            posts.map((p) => <PostCard key={p.id} post={p} />)
          )}
        </div>

        {hasMore && <LoadMoreButton loading={loading} onClick={loadMore} id="forum-load-more" />}
      </div>
    </>
  );
}
