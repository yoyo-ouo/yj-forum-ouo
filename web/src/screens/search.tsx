import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { AppBar, Avatar, Empty, Screen, Segmented, Skeletons } from "../components/mobile";
import { Icon } from "../components/icons";
import { CATEGORY_LABELS, stripHtml, timeAgo } from "../lib/format";
import type { Post } from "../lib/types";

type SearchTab = "all" | "posts" | "users" | "articles";

/** 搜索结果里的用户（对齐 server models.UserBrief；关注数后端暂未下发，有则展示） */
interface SearchUser {
  id: string;
  name: string;
  avatar?: string;
  prefix?: string;
  intro?: string;
  followers?: number;
  followers_count?: number;
}

/** 搜索结果里的会馆文章（对齐 server models.ArticleSearchItem；摘要为可选字段） */
interface SearchArticle {
  id: string;
  title?: string;
  guild_name?: string;
  created_at?: string;
  summary?: string;
}

const TABS: { key: SearchTab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "posts", label: "帖子" },
  { key: "users", label: "用户" },
  { key: "articles", label: "文章" },
];

/* 最近搜索：只存本机（最多 8 条，可单条删除 / 清空） */
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

function persistRecent(list: string[]): string[] {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式 / 存储禁用时静默降级 */
  }
  return list;
}

function rememberRecent(keyword: string): string[] {
  return persistRecent([keyword, ...readRecent().filter((item) => item !== keyword)].slice(0, RECENT_LIMIT));
}

function forgetRecent(keyword: string): string[] {
  return persistRecent(readRecent().filter((item) => item !== keyword));
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

/** 错误文案：底层直出的技术信息（mock / not found / fetch 失败）换成用户能看懂的话 */
function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (!raw || /not found|mock:|failed to fetch|networkerror|load failed/i.test(raw)) return "网络开小差了，请稍后重试";
  return raw;
}

/** 搜索结果的次要信息：作者 / 时间 / 统计，统一 11px */
function Meta({ parts }: { parts: (string | undefined | null | false)[] }) {
  const list = parts.filter(Boolean) as string[];
  return (
    <div className="sr-meta">
      {list.map((text, index) => (
        <React.Fragment key={`${text}-${index}`}>
          {index > 0 ? <i className="sr-dot" aria-hidden="true" /> : null}
          <span>{text}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function SearchScreen({ initial = "" }: { initial?: string }) {
  const { push, pop } = useNav();
  const showToast = useApp((s) => s.showToast);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 输入框实时值与「已提交」的关键词分离：输入不触发请求
  const [kw, setKw] = useState(initial);
  const [appliedKw, setAppliedKw] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [posts, setPosts] = useState<Post[]>([]);
  const [users, setUsers] = useState<SearchUser[]>([]);
  const [articles, setArticles] = useState<SearchArticle[]>([]);
  const [postsTotal, setPostsTotal] = useState(0);
  const [usersTotal, setUsersTotal] = useState(0);
  const [articlesTotal, setArticlesTotal] = useState(0);
  const [postsMore, setPostsMore] = useState(false);
  const [usersMore, setUsersMore] = useState(false);
  const [articlesMore, setArticlesMore] = useState(false);
  // 已加载文章结果对应的关键词（文章 Tab 懒加载，换词后重新拉取）
  const [articleKw, setArticleKw] = useState("");
  const [searching, setSearching] = useState(false);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [failed, setFailed] = useState("");
  const [recent, setRecent] = useState<string[]>(() => readRecent());

  // 「both」搜索最近一次成功的页码（帖子/用户共用）；文章请求序号（丢弃迟到响应）
  const searchPageRef = useRef(1);
  const artSeqRef = useRef(0);

  const doSearch = useCallback(
    async (keyword: string, page = 1, append = false) => {
      setSearching(true);
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
          setPostsTotal(Number(res?.posts_total) || nextPosts.length);
          setUsersTotal(Number(res?.users_total) || nextUsers.length);
        }
        setPostsMore(!!res?.posts_has_more);
        setUsersMore(!!res?.users_has_more);
        setFailed("");
        searchPageRef.current = page;
      } catch (error) {
        const message = friendlyError(error);
        if (!append) {
          setPosts([]);
          setUsers([]);
          setPostsTotal(0);
          setUsersTotal(0);
          setFailed(message);
        }
        showToast(message, "error");
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
      if (!append) setArticlesTotal(Number(res?.total) || list.length);
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

  // 来自其它页的深链（如广场顶栏搜索）：进入或关键词变化时按 initial 搜一次
  useEffect(() => {
    const keyword = initial.trim();
    if (!keyword) return;
    setKw(keyword);
    setAppliedKw(keyword);
    setArticles([]);
    setArticlesMore(false);
    setArticlesTotal(0);
    setArticleKw("");
    artSeqRef.current++;
    searchPageRef.current = 1;
    setRecent(rememberRecent(keyword));
    void doSearch(keyword, 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // 文章 Tab /「全部」：关键词变化后惰性加载（延后一个 tick，避免在 effect 内同步置加载态）
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
    if (keyword === appliedKw) {
      // 同一关键词重复提交：只需要刷新，不清空已有结果
      void doSearch(keyword, 1, false);
      return;
    }
    setAppliedKw(keyword);
    // 关键词变化：文章结果失效，切到文章 Tab /「全部」时再按需加载
    setArticles([]);
    setArticlesMore(false);
    setArticlesTotal(0);
    setArticleKw("");
    artSeqRef.current++;
    searchPageRef.current = 1;
    setRecent(rememberRecent(keyword));
    inputRef.current?.blur();
    void doSearch(keyword, 1, false);
  };

  const retry = () => submit(appliedKw || kw);

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

  const totalResults = posts.length + users.length + articles.length;
  const loaded = !searching && !articlesLoading;
  const allEmpty = loaded && !!appliedKw && totalResults === 0;
  const failedHard = !!failed && posts.length === 0 && users.length === 0;
  const articleReady = isArticleKeyword(appliedKw) && articleKw === appliedKw;

  const countTag = (value: number) =>
    value > 0 ? <span className="sr-count">{value > 99 ? "99+" : value}</span> : null;

  /* ------------------------------ 空查询：最近搜索 +热门分类 ------------------------------ */
  const quickPanel = (
    <div className="sr-quick">
      {recent.length > 0 ? (
        <section className="sr-block">
          <header className="sr-block-head">
            <span className="sr-block-title">最近搜索</span>
            <button type="button" className="sr-head-action" onClick={() => setRecent(clearRecent())}>清空</button>
          </header>
          <div className="sr-pills">
            {recent.map((keyword) => (
              <span className="sr-pill" key={keyword}>
                <button type="button" className="sr-pill-text" onClick={() => submit(keyword)}>{keyword}</button>
                <button
                  type="button"
                  className="sr-pill-del"
                  aria-label={`删除最近搜索 ${keyword}`}
                  onClick={() => setRecent(forgetRecent(keyword))}
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        </section>
      ) : (
        <p className="sr-tip">输入关键词开始搜索，最近搜过的词会留在这里</p>
      )}

      <section className="sr-block">
        <header className="sr-block-head">
          <span className="sr-block-title">热门分类</span>
        </header>
        <div className="sr-pills">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <button type="button" key={key} className="sr-pill sr-pill--cat" onClick={() => submit(label)}>
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  /* ------------------------------ 结果 ------------------------------ */
  const resultPanel = (
    <div className="sr-results">
      <Segmented
        className="sr-seg"
        value={tab}
        onChange={setTab}
        items={TABS.map((item) => ({
          key: item.key,
          label: (
            <>
              {item.label}
              {item.key === "all"
                ? countTag(postsTotal + usersTotal + articlesTotal)
                : item.key === "posts"
                  ? countTag(postsTotal)
                  : item.key === "users"
                    ? countTag(usersTotal)
                    : countTag(articlesTotal)}
            </>
          ),
        }))}
      />

      {failedHard ? (
        <Empty icon="search" title="搜索失败" hint={failed} action={<button type="button" className="m-btn m-btn--sm" onClick={retry}>重试</button>} />
      ) : searching && posts.length === 0 && users.length === 0 && !articles.length ? (
        <Skeletons count={3} />
      ) : allEmpty ? (
        <Empty icon="search" title="没有找到相关结果" hint="换个关键词试试" />
      ) : (
        <>
          {showPosts ? (
            <>
              {tab === "all" && posts.length > 0 ? <div className="sr-section-title">帖子</div> : null}
              {posts.length > 0 ? (
                <div className="sr-list">
                  {posts.map((post) => {
                    const author = post.user_name || post.author_name || "论坛用户";
                    const summary = post.summary || stripHtml(post.content || "");
                    return (
                      <button type="button" className="sr-item" key={post.id} onClick={() => push("post", { id: post.id })}>
                        <div className="sr-item-title">{post.title || "无标题"}</div>
                        {summary ? <p className="sr-item-summary">{summary}</p> : null}
                        <Meta
                          parts={[
                            author,
                            timeAgo(post.published_at || post.created_at),
                            `${post.likes ?? 0} 赞`,
                            `${post.comment_count ?? 0} 评论`,
                          ]}
                        />
                      </button>
                    );
                  })}
                </div>
              ) : tab === "posts" && loaded ? (
                <Empty icon="search" title="没有找到相关结果" hint="换个关键词试试" />
              ) : null}
            </>
          ) : null}

          {showUsers && (users.length > 0 || tab === "users") ? (
            <>
              {tab === "all" && users.length > 0 ? <div className="sr-section-title">用户</div> : null}
              {users.length > 0 ? (
                <div className="sr-list">
                  {users.map((item) => {
                    const followerCount = item.followers ?? item.followers_count;
                    return (
                      <button type="button" className="sr-user" key={item.id} onClick={() => push("user", { id: item.id })}>
                        <Avatar src={item.avatar} name={item.name} size={40} />
                        <span className="sr-user-main">
                          <span className="sr-user-name">{item.name}</span>
                          <span className="sr-user-intro">{item.intro || "论坛用户"}</span>
                        </span>
                        {typeof followerCount === "number" ? (
                          <span className="sr-user-follow">
                            <b>{followerCount}</b>
                            <i>关注者</i>
                          </span>
                        ) : (
                          <Icon name="forward" size={16} className="sr-user-chev" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {tab === "users" && users.length === 0 && loaded ? (
                <Empty icon="search" title="没有找到相关结果" hint="换个关键词试试" />
              ) : null}
            </>
          ) : null}

          {showArticles && (articles.length > 0 || tab === "articles") ? (
            <>
              {tab === "all" && articles.length > 0 ? <div className="sr-section-title">文章</div> : null}
              {!isArticleKeyword(appliedKw) ? (
                <p className="sr-tip">文章搜索至少需要 2 个字符</p>
              ) : articlesLoading && !articleReady ? (
                <Skeletons count={2} />
              ) : articles.length > 0 ? (
                <div className="sr-list">
                  {articles.map((item) => (
                    <button type="button" className="sr-item" key={item.id} onClick={() => push("article", { id: item.id })}>
                      <div className="sr-item-title">{item.title || "无标题"}</div>
                      {item.summary ? <p className="sr-item-summary">{item.summary}</p> : null}
                      <Meta parts={[item.guild_name, timeAgo(item.created_at)]} />
                    </button>
                  ))}
                </div>
              ) : tab === "articles" && loaded ? (
                <Empty icon="search" title="没有找到相关结果" hint="换个关键词试试" />
              ) : null}
            </>
          ) : null}

          {showLoadMore ? (
            <button type="button" className="m-more" disabled={searching || articlesLoading} onClick={loadMore}>
              {searching || articlesLoading ? "加载中…" : "加载更多"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <Screen
      bodyClassName="sr-body"
      appbar={
        <AppBar
          back
          actions={<button type="button" className="m-btn m-btn--ghost m-btn--sm sr-cancel" onClick={pop}>取消</button>}
        >
          <div className="sr-field">
            <Icon name="search" size={17} className="sr-field-icon" />
            <input
              ref={inputRef}
              type="text"
              className="sr-input"
              value={kw}
              placeholder="搜索帖子、用户、文章"
              aria-label="搜索关键词"
              autoComplete="off"
              enterKeyHint="search"
              autoFocus={!initial}
              onChange={(event) => setKw(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />
            {kw ? (
              <button
                type="button"
                className="sr-field-clear"
                aria-label="清空搜索词"
                onClick={() => {
                  setKw("");
                  inputRef.current?.focus();
                }}
              >
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </div>
        </AppBar>
      }
    >
      {appliedKw ? resultPanel : quickPanel}
    </Screen>
  );
}
