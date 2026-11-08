import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { Avatar, EmptyState, Loading, PostCard, TopBar } from "../components/ui";
import { timeAgo } from "../lib/format";
import type { Post } from "../lib/types";
// 仅本页需要的移动端适配（容器内边距 / 原生按钮复位），不改 main.tsx 与共享样式
import "../styles/search-compose-auth-page.css";

type SearchTab = "all" | "posts" | "users" | "articles";

/** 搜索结果里的用户（对齐 server models.UserBrief） */
interface SearchUser {
  id: string;
  name: string;
  avatar?: string;
  prefix?: string;
  intro?: string;
}

/** 搜索结果里的会馆文章（对齐 server models.ArticleSearchItem） */
interface SearchArticle {
  id: string;
  title?: string;
  guild_name?: string;
  created_at?: string;
}

const TABS: { key: SearchTab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "posts", label: "帖子" },
  { key: "users", label: "用户" },
  { key: "articles", label: "文章" },
];

/* 最近搜索：纯本地记录（Web 端无此功能，App 内补一个轻量入口） */
const RECENT_KEY = "yj.search.recent";
const RECENT_LIMIT = 8;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function rememberRecent(keyword: string): string[] {
  const next = [keyword, ...readRecent().filter((item) => item !== keyword)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式 / 存储禁用时静默降级 */
  }
  return next;
}

function clearRecent(): string[] {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* 同 rememberRecent */
  }
  return [];
}

/** 文章搜索服务端要求关键词 ≥ 2 个字符（中文/拉丁均按 rune 计） */
function isArticleKeyword(keyword: string): boolean {
  return Array.from(keyword).length >= 2;
}

export function SearchScreen({ initial = "" }: { initial?: string }) {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 输入框实时值与「已提交」的关键词分离：输入不触发请求（对齐 Web）
  const [kw, setKw] = useState(initial);
  const [appliedKw, setAppliedKw] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [posts, setPosts] = useState<Post[]>([]);
  const [users, setUsers] = useState<SearchUser[]>([]);
  const [articles, setArticles] = useState<SearchArticle[]>([]);
  const [postsMore, setPostsMore] = useState(false);
  const [usersMore, setUsersMore] = useState(false);
  const [articlesMore, setArticlesMore] = useState(false);
  // 已加载文章结果对应的关键词（文章 Tab 懒加载，换词后重新拉取）
  const [articleKw, setArticleKw] = useState("");
  const [searching, setSearching] = useState(false);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecent());

  // 「both」搜索最近一次成功的页码（帖子/用户共用）；文章请求序号（丢弃迟到响应）
  const searchPageRef = useRef(1);
  const artSeqRef = useRef(0);

  const doSearch = useCallback(
    async (keyword: string, page = 1, append = false) => {
      setSearching(true);
      setSearched(true);
      try {
        const res: any = await api.search(keyword, "both", page, 20);
        const nextPosts = (res?.posts || []) as Post[];
        const nextUsers = (res?.users || []) as SearchUser[];
        if (append) {
          setPosts((current) => [...current, ...nextPosts]);
          setUsers((current) => [...current, ...nextUsers]);
        } else {
          setPosts(nextPosts);
          setUsers(nextUsers);
        }
        setPostsMore(!!res?.posts_has_more);
        setUsersMore(!!res?.users_has_more);
        searchPageRef.current = page;
      } catch (error) {
        if (!append) {
          setPosts([]);
          setUsers([]);
        }
        showToast(error instanceof Error ? error.message : "搜索失败", "error");
      } finally {
        setSearching(false);
      }
    },
    [showToast],
  );

  // 文章搜索：结果独立存储，与帖子/用户互不影响；序号守卫丢弃迟到响应
  const searchArticles = useCallback(async (keyword: string, page = 1, append = false) => {
    if (!isArticleKeyword(keyword)) return;
    const seq = ++artSeqRef.current;
    setArticlesLoading(true);
    try {
      const res: any = await api.searchArticles(keyword, page, 20);
      if (seq !== artSeqRef.current) return;
      const list = (res?.articles || []) as SearchArticle[];
      setArticles((current) => (append ? [...current, ...list] : list));
      setArticlesMore(!!res?.has_more);
    } catch {
      if (seq === artSeqRef.current && !append) {
        setArticles([]);
        setArticlesMore(false);
      }
    } finally {
      if (seq === artSeqRef.current) {
        setArticleKw(keyword);
        setArticlesLoading(false);
      }
    }
  }, []);

  // 来自其它页的深链（如信息流顶栏搜索）：进入或关键词变化时按 initial 搜一次
  useEffect(() => {
    const keyword = initial.trim();
    if (!keyword) return;
    setKw(keyword);
    setAppliedKw(keyword);
    setArticles([]);
    setArticlesMore(false);
    setArticleKw("");
    artSeqRef.current++;
    searchPageRef.current = 1;
    setRecent(rememberRecent(keyword));
    void doSearch(keyword, 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // 文章 Tab / 「全部」：关键词变化后惰性加载（延后一个 tick，避免在 effect 内同步置加载态）
  useEffect(() => {
    if ((tab !== "articles" && tab !== "all") || !isArticleKeyword(appliedKw) || articleKw === appliedKw) return;
    const timer = window.setTimeout(() => void searchArticles(appliedKw, 1, false), 0);
    return () => window.clearTimeout(timer);
  }, [tab, appliedKw, articleKw, searchArticles]);

  const submit = (value?: string) => {
    const keyword = (value ?? kw).trim();
    if (!keyword) {
      showToast("请输入搜索关键词", "error");
      return;
    }
    setKw(keyword);
    setAppliedKw(keyword);
    // 关键词变化：文章结果失效，切到文章 Tab /「全部」时再按需加载
    setArticles([]);
    setArticlesMore(false);
    setArticleKw("");
    artSeqRef.current++;
    searchPageRef.current = 1;
    setRecent(rememberRecent(keyword));
    inputRef.current?.blur();
    void doSearch(keyword, 1, false);
  };

  // 文章结果是否已就位：满足服务端 k≥2 且与当前关键词一致（防串词）
  const articlesMoreReady = articlesMore && isArticleKeyword(appliedKw) && articleKw === appliedKw;

  // 「加载更多」显示条件：单 Tab 沿用各自翻页状态；「全部」为帖子/用户或文章任一可继续
  const showLoadMore =
    tab === "all"
      ? postsMore || usersMore || articlesMoreReady
      : tab === "posts"
        ? postsMore
        : tab === "users"
          ? usersMore
          : articlesMore;

  const loadMore = () => {
    if (tab === "all") {
      if (postsMore || usersMore) void doSearch(appliedKw, searchPageRef.current + 1, true);
      if (articlesMoreReady) void searchArticles(appliedKw, Math.ceil(articles.length / 20) + 1, true);
      return;
    }
    if (tab === "articles") {
      void searchArticles(appliedKw, Math.ceil(articles.length / 20) + 1, true);
      return;
    }
    void doSearch(appliedKw, searchPageRef.current + 1, true);
  };

  const showPosts = tab === "posts" || tab === "all";
  const showUsers = tab === "users" || tab === "all";
  const showArticles = tab === "articles" || tab === "all";

  return (
    <div className="screen">
      <TopBar title="搜索" back />
      <div className="forum-container search-page">
        <div className="search-page-form">
          <div className="search-page-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              id="search-page-input"
              className="search-page-input"
              placeholder="输入搜索关键词..."
              autoComplete="off"
              autoFocus={!initial}
              value={kw}
              onChange={(event) => setKw(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />
            <button type="button" id="search-page-btn" className="search-page-btn" aria-label="搜索" onClick={() => submit()}>
              <i className="fa fa-search" />
            </button>
          </div>
        </div>

        {searched ? (
          <div id="search-page-results">
            <div className="forum-header" style={{ paddingTop: 0 }}>
              <p className="forum-subtitle" id="search-subtitle" style={{ marginBottom: 12 }}>
                {searching ? "正在搜索..." : `「${appliedKw}」的搜索结果`}
              </p>
            </div>

            <div className="search-tabs" id="search-tabs">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`search-tab ${tab === item.key ? "active" : ""}`}
                  data-tab={item.key}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === "all" ? <h2 className="search-section-title">帖子</h2> : null}
            {showPosts ? (
              <div className="forum-post-list" id="search-post-list">
                {searching && posts.length === 0 ? (
                  <Loading text="正在搜索…" />
                ) : posts.length === 0 ? (
                  <EmptyState text="未找到相关帖子" />
                ) : (
                  posts.map((post) => <PostCard key={post.id} post={post} />)
                )}
              </div>
            ) : null}

            {tab === "all" ? <h2 className="search-section-title">用户</h2> : null}
            {showUsers ? (
              <div className="forum-user-list" id="search-user-list">
                {searching && users.length === 0 ? (
                  <Loading text="正在搜索…" />
                ) : users.length === 0 ? (
                  <EmptyState text="未找到相关用户" />
                ) : (
                  users.map((item) => (
                    <button type="button" className="search-user-item" key={item.id} onClick={() => push("user", { id: item.id })}>
                      <div className="search-user-avatar-wrapper">
                        <Avatar src={item.avatar} name={item.name} size={56} />
                      </div>
                      <div className="search-user-info">
                        <div className="search-user-name" style={{ whiteSpace: "nowrap" }}>
                          {item.name}
                        </div>
                        <div className="search-user-time">{item.intro || "论坛用户"}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : null}

            {tab === "all" ? <h2 className="search-section-title">文章</h2> : null}
            {showArticles ? (
              <div className="search-article-list" id="search-article-list" style={{ display: "flex" }}>
                {!isArticleKeyword(appliedKw) ? (
                  <EmptyState text="文章搜索请至少输入 2 个字符" />
                ) : articlesLoading || articleKw !== appliedKw ? (
                  <Loading text="正在搜索文章…" />
                ) : articles.length === 0 ? (
                  <EmptyState text="未找到相关文章" />
                ) : (
                  articles.map((item) => (
                    <button type="button" className="search-article-item" key={item.id} onClick={() => push("article", { id: item.id })}>
                      <div className="search-article-icon">
                        <i className="fa fa-book" />
                      </div>
                      <div className="search-article-info">
                        <div className="search-article-title">{item.title || "无标题"}</div>
                        <div className="search-article-meta">
                          {item.guild_name ? (
                            <span className="search-article-guild">
                              <i className="fa fa-home" /> {item.guild_name}
                            </span>
                          ) : null}
                          {item.created_at ? <span className="search-article-time">{timeAgo(item.created_at)}</span> : null}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : null}

            {showLoadMore ? (
              <div className="forum-load-more">
                <button type="button" id="search-load-more" disabled={searching || articlesLoading} onClick={loadMore}>
                  {searching || articlesLoading ? "加载中…" : "加载更多"}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="search-recent">
            {recent.length > 0 ? (
              <>
                <div className="search-recent-head">
                  <span>最近搜索</span>
                  <button type="button" className="link-btn" onClick={() => setRecent(clearRecent())}>
                    清空
                  </button>
                </div>
                <div className="forum-category-tabs">
                  {recent.map((item) => (
                    <button type="button" key={item} className="forum-tab" onClick={() => submit(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState text="输入关键词开始搜索" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
