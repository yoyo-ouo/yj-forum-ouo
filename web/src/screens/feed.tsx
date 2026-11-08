import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { EmptyState, Loading, PostCard } from "../components/ui";
import { CATEGORY_LABELS } from "../lib/format";
import type { Post } from "../lib/types";

const SPACES = [
  { key: "public", label: "公共空间" },
  { key: "guild", label: "会馆空间" },
] as const;

export function FeedScreen() {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const [space, setSpace] = useState<"public" | "guild">("public");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const site = useQuery({ queryKey: ["site-config"], queryFn: () => api.siteConfig(), staleTime: 5 * 60_000 });
  const random = useQuery({ queryKey: ["random-posts"], queryFn: () => api.randomPosts(), staleTime: 5 * 60_000 });

  const load = useCallback(
    async (nextPage: number, replace = false) => {
      if (replace) setLoading(true);
      else setLoadingMore(true);
      try {
        const res = await api.feed({ space, category: category || undefined, page: nextPage, page_size: 20 });
        const incoming = res.items || [];
        setItems((current) => (replace ? incoming : [...current, ...incoming]));
        setPage(nextPage);
        setHasMore(Boolean(res.has_more));
      } catch (error) {
        showToast(error instanceof Error ? error.message : "加载失败", "error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [space, category, showToast],
  );

  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(true);
    void load(1, true);
  }, [space, category, load]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
        void load(page + 1);
      }
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page, load]);

  const announcement = site.data?.data?.announcement;
  const announcementText =
    typeof announcement === "string" ? announcement : announcement?.text || announcement?.title || "";
  const recommended = random.data?.posts || [];

  return (
    <div className="screen">
      <header className="topbar">
        <div className="row" style={{ flex: 1, gap: 8 }}>
          <span className="boot-logo" style={{ width: 28, height: 28, borderRadius: 10, fontSize: 13, margin: 0 }}>妖</span>
          <strong style={{ fontSize: 16 }}>妖精论坛</strong>
        </div>
        <button className="icon-btn" aria-label="搜索" onClick={() => push("search")}>⌕</button>
        <button className="icon-btn" aria-label="会馆" onClick={() => push("guilds")}>▦</button>
      </header>

      {announcementText ? (
        <div className="notice-bar">
          <span className="notice-dot" />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{announcementText}</span>
          <button className="link-btn" onClick={() => push("changelog")}>查看</button>
        </div>
      ) : null}

      {recommended.length > 0 ? (
        <>
          <div className="section-head"><strong>为你推荐</strong><span className="small muted">随机精选</span></div>
          <div className="hero-rail">
            {recommended.slice(0, 6).map((post, index) => (
              <div key={post.id} className={`hero-card hero-${(index % 3) + 1}`} onClick={() => push("post", { id: post.id })}>
                <span className="pill" style={{ alignSelf: "flex-start" }}>{post.user_guild_name || "帖子"}</span>
                <strong>{post.title}</strong>
                <small>{post.author_name || "论坛"} · ♡ {post.likes ?? 0}</small>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="chips">
        {SPACES.map((item) => (
          <button
            key={item.key}
            className={`chip ${space === item.key ? "on" : ""}`}
            onClick={() => setSpace(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="chips" style={{ paddingTop: 0 }}>
        <button className={`chip ${!category ? "on" : ""}`} onClick={() => setCategory("")}>全部</button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <button key={key} className={`chip ${category === key ? "on" : ""}`} onClick={() => setCategory(key)}>{label}</button>
        ))}
      </div>

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState text="这个分类还没有帖子" action={<button className="btn primary" onClick={() => push("compose")}>去发第一帖</button>} />
      ) : (
        <>
          {items.map((post) => <PostCard key={post.id} post={post} />)}
          <div ref={sentinel} />
          {loadingMore ? <Loading text="加载更多…" /> : null}
          {!hasMore ? <div className="list-end">— 到底了 —</div> : null}
        </>
      )}
    </div>
  );
}
