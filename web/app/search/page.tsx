"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { miscApi, Post, UserBrief } from "@/lib/api";

const CATEGORY_LABELS: Record<string, string> = {
  general: "综合", talk: "闲聊", question: "求助", share: "分享", creative: "创作",
};

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [kw, setKw] = useState("");
  const [tab, setTab] = useState<"posts" | "users">("posts");
  const [posts, setPosts] = useState<Post[]>([]);
  const [users, setUsers] = useState<UserBrief[]>([]);
  const [postsMore, setPostsMore] = useState(false);
  const [usersMore, setUsersMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = async (k: string, type: "both", page = 1, append = false) => {
    setSearching(true);
    setSearched(true);
    try {
      const r = await miscApi.search(k, type, page, 20);
      if (append) {
        setPosts((p) => [...p, ...(r.posts || [])]);
      } else {
        setPosts(r.posts || []);
        setUsers(r.users || []);
      }
      setPostsMore(!!r.posts_has_more);
      setUsersMore(!!r.users_has_more);
    } catch {
      if (!append) { setPosts([]); setUsers([]); }
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const k = params.get("k");
    if (k) {
      setKw(k);
      doSearch(k, "both", 1, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submit = () => {
    const k = kw.trim();
    if (k.length < 2) return;
    router.push(`/search?k=${encodeURIComponent(k)}`);
  };

  const loadMore = () => {
    const page = tab === "posts" ? Math.ceil(posts.length / 20) + 1 : Math.ceil(users.length / 20) + 1;
    doSearch(kw, "both", page, true);
  };

  return (
    <div className="forum-container">
      <div className="forum-header">
        <h1 className="forum-title">搜索</h1>
      </div>

      <div className="search-page-form">
        <div className="search-page-input-wrapper">
          <input
            type="text"
            id="search-page-input"
            className="search-page-input"
            placeholder="输入搜索关键词..."
            autoComplete="off"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button id="search-page-btn" className="search-page-btn" onClick={submit}>
            <i className="fa fa-search"></i> 搜索
          </button>
        </div>
      </div>

      {searched && (
        <div id="search-page-results">
          <div className="forum-header" style={{ paddingTop: 0 }}>
            <p className="forum-subtitle" id="search-subtitle">{searching ? "正在搜索..." : `「${kw}」的搜索结果`}</p>
          </div>

          <div className="search-tabs" id="search-tabs">
            <button className={`search-tab ${tab === "posts" ? "active" : ""}`} data-tab="posts" onClick={() => setTab("posts")}>帖子</button>
            <button className={`search-tab ${tab === "users" ? "active" : ""}`} data-tab="users" onClick={() => setTab("users")}>用户</button>
          </div>

          <div className="forum-post-list" id="search-post-list" style={{ display: tab === "posts" ? "block" : "none" }}>
            {searching && posts.length === 0 ? (
              <div className="forum-loading">加载中...</div>
            ) : posts.length === 0 ? (
              <div className="forum-loading">未找到相关帖子</div>
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
                    </div>
                    <h3 className="post-card-title">{p.title}</h3>
                    <p className="post-card-summary">{p.summary?.replace(/\n/g, " ")}</p>
                  </div>
                </Link>
              ))
            )}
          </div>

          <div className="forum-user-list" id="search-user-list" style={{ display: tab === "users" ? "block" : "none" }}>
            {searching && users.length === 0 ? (
              <div className="forum-loading">加载中...</div>
            ) : users.length === 0 ? (
              <div className="forum-loading">未找到相关用户</div>
            ) : (
              users.map((u) => (
                <Link className="post-card" href={`/users/${u.id}`} key={u.id}>
                  <div className="post-card-avatar-wrap">
                    <img className="post-card-avatar" src={u.avatar} alt="" loading="lazy" />
                  </div>
                  <div className="post-card-body">
                    <div className="post-card-meta">
                      <span className="post-card-author">{u.name}</span>
                      {u.vip === "1" && <span className="post-card-category">VIP</span>}
                    </div>
                    <p className="post-card-summary">{u.intro || ""}</p>
                  </div>
                </Link>
              ))
            )}
          </div>

          {(tab === "posts" ? postsMore : usersMore) && (
            <div className="forum-load-more" id="search-load-more">
              <button onClick={loadMore} disabled={searching}>{searching ? "加载中..." : "加载更多"}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <>
      <Header />
      <Suspense fallback={<div style={{ textAlign: "center", padding: 40 }}>加载中...</div>}>
        <SearchInner />
      </Suspense>
    </>
  );
}
