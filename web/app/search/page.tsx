"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import PostCard from "@/components/PostCard";
import { ProfilePrefixBadge } from "@/components/PrefixBadge";
import { miscApi, Post, UserBrief } from "@/lib/api";

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

  const doSearch = async (k: string, page = 1, append = false) => {
    setSearching(true);
    setSearched(true);
    try {
      const r = await miscApi.search(k, "both", page, 20);
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
      doSearch(k, 1, false);
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
    doSearch(kw, page, true);
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
              <div className="forum-empty">未找到相关帖子</div>
            ) : (
              posts.map((p) => <PostCard key={p.id} post={p} />)
            )}
          </div>

          <div className="forum-user-list" id="search-user-list">
            {searching && users.length === 0 ? (
              <div className="forum-loading">加载中...</div>
            ) : users.length === 0 ? (
              <div className="forum-empty">未找到相关用户</div>
            ) : (
              <div style={{ display: tab === "users" ? "block" : "none" }}>
                {users.map((u) => {
                  const vipIcon = u.vip !== "0" ? (
                    <img
                      src="https://op-kdocs.wpscdn.cn/odimg/web/2024-03-26-12-26/vipnew_hover.svg"
                      className="prefix-badge-svg"
                      style={{ width: 22, height: 22 }}
                      alt="VIP"
                    />
                  ) : null;
                  return (
                    <Link className="search-user-item" href={`/users/${u.id}`} key={u.id} style={{ display: "flex" }}>
                      <div className="search-user-avatar-wrapper">
                        {u.avatar ? (
                          <img src={u.avatar} className="search-user-avatar" loading="lazy" alt={u.name} />
                        ) : (
                          <i className="fa fa-user avatar-fallback search-user-avatar-fallback"></i>
                        )}
                        {vipIcon}
                        <ProfilePrefixBadge prefix={u.prefix} />
                      </div>
                      <div className="search-user-info">
                        <div className="search-user-name" style={{ whiteSpace: "nowrap" }}>{u.name}</div>
                        <div className="search-user-time">注册于 未知</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
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
