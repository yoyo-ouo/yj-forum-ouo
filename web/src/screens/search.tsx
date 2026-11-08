import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { Avatar, EmptyState, Loading, PostCard, TopBar } from "../components/ui";

type SearchTab = "all" | "posts" | "users" | "articles";

export function SearchScreen({ initial = "" }: { initial?: string }) {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const [keyword, setKeyword] = useState(initial);
  const [tab, setTab] = useState<SearchTab>("all");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);

  const run = async (value = keyword, nextTab = tab) => {
    const key = value.trim();
    if (!key) return;
    setLoading(true);
    try {
      if (nextTab === "articles") {
        const res = await api.searchArticles(key);
        setArticles(res.articles || []);
        setResult(null);
      } else {
        const type = nextTab === "posts" ? "posts" : nextTab === "users" ? "users" : "both";
        const res = await api.search(key, type);
        setResult(res);
        setArticles([]);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "搜索失败", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initial) void run(initial, "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const posts = result?.posts || [];
  const users = result?.users || [];

  return (
    <div className="screen">
      <TopBar title="搜索" back />
      <div className="search-head">
        <div className="search-input-wrap">
          <span className="muted">⌕</span>
          <input
            autoFocus
            value={keyword}
            placeholder="搜索帖子、用户、文章"
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
          />
          <button className="btn primary sm" onClick={() => void run()}>搜索</button>
        </div>
      </div>
      <div className="tabs">
        {([["all", "全部"], ["posts", "帖子"], ["users", "用户"], ["articles", "文章"]] as [SearchTab, string][]).map(([key, label]) => (
          <button key={key} className={`tab-item ${tab === key ? "on" : ""}`} onClick={() => { setTab(key); if (keyword.trim()) void run(keyword, key); }}>{label}</button>
        ))}
      </div>
      {loading ? <Loading /> : null}
      {!loading && !result && articles.length === 0 ? <EmptyState text="输入关键词开始搜索" /> : null}
      {!loading && tab !== "articles" ? (
        <>
          {posts.length > 0 ? <div className="section-title">帖子</div> : null}
          {posts.map((post: any) => <PostCard key={post.id} post={post} />)}
          {users.length > 0 ? <div className="section-title">用户</div> : null}
          {users.map((item: any) => (
            <div key={item.id} className="search-result row" onClick={() => push("user", { id: item.id })}>
              <Avatar src={item.avatar} name={item.name} size={34} />
              <div style={{ flex: 1 }}><h4>{item.name}</h4><p>{item.intro || "论坛用户"}</p></div>
              <span className="muted">›</span>
            </div>
          ))}
        </>
      ) : null}
      {!loading && tab === "articles" ? (
        articles.length === 0 ? <EmptyState text="没有找到相关文章" /> : articles.map((item: any) => (
          <div key={item.id} className="info-card" onClick={() => push("article", { id: item.id })}>
            <h4>{item.title}</h4>
            <p>{item.summary || item.excerpt || "会馆文章"}</p>
            <div className="meta">{item.guild_name || "会馆"}</div>
          </div>
        ))
      ) : null}
    </div>
  );
}
