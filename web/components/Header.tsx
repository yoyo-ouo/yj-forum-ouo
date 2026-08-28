"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import { miscApi } from "@/lib/api";
import { useCenterCard } from "./CenterCard";

export default function Header() {
  const { theme, setTheme, user, userId, logout } = useStore();
  const { show } = useCenterCard();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showDonate, setShowDonate] = useState(false);
  const [showVote, setShowVote] = useState(false);
  const [showBug, setShowBug] = useState(false);
  const [voteStats, setVoteStats] = useState<{ v1: number; v2: number } | null>(null);
  const settingsRef = useRef<HTMLLIElement>(null);
  const deferredPromptRef = useRef<Event | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // 关闭移动端菜单（路由切换后）
  useEffect(() => {
    setShowMobileMenu(false);
  }, [pathname]);

  // PWA 安装：捕获 beforeinstallprompt（与 legacy base.html 一致）
  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e;
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  // 首页点击 Escape 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowDonate(false);
        setShowVote(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 投票统计加载
  useEffect(() => {
    if (showVote) {
      miscApi.voteStats().then((r) => setVoteStats(r.stats)).catch(() => {});
    }
  }, [showVote]);

  const doSearch = () => {
    const k = search.trim();
    if (k) router.push(`/search?k=${encodeURIComponent(k)}`);
  };

  const submitVote = async (choice: string) => {
    try {
      const r = await miscApi.vote(choice);
      setVoteStats(r.stats);
      show(
        <div style={{ textAlign: "center", padding: 12 }}>
          <p>投票成功！</p>
          <p>V1: {r.stats.v1} | V2: {r.stats.v2}</p>
        </div>
      );
    } catch (e: any) {
      show(<p style={{ textAlign: "center" }}>{e.message}</p>);
    }
  };

  const showEasterEgg = async () => {
    try {
      const egg = await miscApi.easterEgg();
      show(
        <>
          <h3 style={{ margin: "0 0 12px" }}>{egg.Name}</h3>
          <div>{egg.Text}</div>
        </>
      );
    } catch {
      show(<p>彩蛋获取失败</p>);
    }
  };

  const installPWA = () => {
    const promptEvent = deferredPromptRef.current as any;
    if (promptEvent && typeof promptEvent.prompt === "function") {
      promptEvent.prompt();
      promptEvent.userChoice
        ?.then((result: { outcome: string }) => {
          if (result && result.outcome === "accepted") {
            try {
              localStorage.setItem("pwa_installed", "1");
            } catch {}
          }
          deferredPromptRef.current = null;
        })
        .catch(() => {
          show(<p style={{ textAlign: "center" }}>当前浏览器不支持安装</p>);
        });
    } else {
      show(
        <div style={{ textAlign: "center", padding: "6px 4px 2px" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>
            当前浏览器不支持安装
          </div>
          <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            您的浏览器暂不支持安装论坛客户端 (PWA)。建议使用 Chrome / Edge / Safari 最新版本再次尝试。
          </div>
        </div>
      );
    }
  };

  return (
    <>
      <header id="header">
        <Link className="header-left" href="/">
          <img src="/assets/img/favicon.png" alt="logo" id="logo" style={{ borderRadius: "50%" }} />
          <h1>妖精论坛</h1>
        </Link>
        <div className="header-center">
          <div id="search">
            <label htmlFor="search_input">
              <input
                id="search_input"
                placeholder="搜索帖子、用户..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()}
              />
            </label>
            <button id="search_button" onClick={doSearch}>
              <img alt="search_Button_ICON" src="/assets/img/search.svg" id="search_Button_ICON" />
            </button>
          </div>
        </div>
        <div className="header-right">
          <ul>
            <li className="header-collapsible">
              <button className="header-btn" id="Easter-Egg" onClick={showEasterEgg}>
                <i className="fa fa-gift"></i>
                <span>彩蛋</span>
              </button>
            </li>
            <li className="header-collapsible">
              <Link className="header-btn" href="/WIKI">
                <img src="/assets/img/wiki_avatar_l.png" alt="" id="WIKIForIcon" />
                <span>WIKI</span>
              </Link>
            </li>
            <li className="header-collapsible">
              <a className="header-btn" href="//hei.navifox.net">
                <i className="fa fa-home"></i>
                <span>会馆</span>
              </a>
            </li>
            <li className="header-collapsible">
              <a className="header-btn" href="//gaz.yjlt.top/" target="_blank" rel="noopener">
                <i className="fa fa-newspaper-o"></i>
                <span>刊物</span>
              </a>
            </li>
            <li className="header-collapsible">
              <button className="header-btn" onClick={() => setShowDonate(true)}>
                <i className="fa fa-heart"></i>
                <span>赞赏</span>
              </button>
            </li>
            <li className="header-collapsible">
              <button className="header-btn" onClick={() => setShowBug(true)}>
                <i className="fa fa-bug"></i>
                <span>Bug提交</span>
              </button>
            </li>
            <li className="header-collapsible">
              <button className="header-btn" onClick={() => setShowVote(true)}>
                <i className="fa fa-random"></i>
                <span>V2新版本</span>
              </button>
            </li>
            <li className="header-collapsible" id="pwa-install-li">
              <button className="header-btn" id="pwa-install-btn" onClick={installPWA}>
                <i className="fa fa-download"></i>
                <span>安装论坛客户端</span>
              </button>
            </li>
            <li className="header-menu-toggle">
              <button className="header-btn" type="button" onClick={() => setShowMobileMenu(!showMobileMenu)}>
                <i className="fa fa-bars"></i>
              </button>
            </li>
            <li className="header-collapsible header-setting" ref={settingsRef}>
              <button className="header-btn" onClick={() => setShowSettings(!showSettings)}>
                <i className="fa fa-cog"></i>
                <span>设置</span>
              </button>
              {showSettings && (
                <div className="setting-dropdown" id="settingDropdown">
                  <ul className="setting-dropdown-menu">
                    <li className="setting-dropdown-title">主题</li>
                    <li className={`setting-dropdown-item ${theme === "day" ? "active" : ""}`} data-value="day" onClick={() => setTheme("day")}>
                      <span className="setting-item-icon"></span>
                      <span className="setting-item-text">亮色</span>
                    </li>
                    <li className={`setting-dropdown-item ${theme === "night" ? "active" : ""}`} data-value="night" onClick={() => setTheme("night")}>
                      <span className="setting-item-icon"></span>
                      <span className="setting-item-text">暗色</span>
                    </li>
                    <li className={`setting-dropdown-item ${theme === "default" ? "active" : ""}`} data-value="default" onClick={() => setTheme("default")}>
                      <span className="setting-item-icon"></span>
                      <span className="setting-item-text">默认</span>
                    </li>
                    <li className="setting-dropdown-divider"></li>
                    {user && (
                      <li className="setting-dropdown-item" onClick={logout}>
                        <span className="setting-item-icon"><i className="fa fa-sign-out"></i></span>
                        <span className="setting-item-text">退出登录</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </li>
            <li>
              <Link id="UserInfo" href={userId ? `/users/${userId}` : "/login"}>
                <div className="user-avatar" id="user-avatar">
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" width={32} height={32} style={{ borderRadius: "50%" }} />
                  ) : (
                    <i className="fa fa-user"></i>
                  )}
                </div>
                <div id="user-name" className="Username">{user ? user.name : "登录"}</div>
              </Link>
            </li>
          </ul>
          <div className={`header-mobile-menu ${showMobileMenu ? "open" : ""}`} id="headerMobileMenu">
            <Link className="mobile-menu-item" href="/WIKI"><i className="fa fa-book"></i> WIKI</Link>
            <a className="mobile-menu-item" href="//hei.navifox.net"><i className="fa fa-home"></i> 会馆</a>
            <a className="mobile-menu-item" href="https://yaonews.unknownmp.top/" target="_blank" rel="noopener"><i className="fa fa-newspaper-o"></i> 日刊</a>
            <button className="mobile-menu-item" onClick={() => setShowDonate(true)}><i className="fa fa-heart"></i> 赞赏</button>
            <button className="mobile-menu-item" onClick={() => setShowBug(true)}><i className="fa fa-bug"></i> Bug举报</button>
            <button className="mobile-menu-item" onClick={() => setShowVote(true)}><i className="fa fa-random"></i> V2新版本</button>
            <button className="mobile-menu-item" id="pwa-install-mobile" onClick={installPWA}><i className="fa fa-download"></i> 安装论坛客户端</button>
            <button className="mobile-menu-item" onClick={showEasterEgg}><i className="fa fa-gift"></i> 彩蛋</button>
            <div className="mobile-menu-divider"></div>
            <div className="mobile-menu-title">主题</div>
            <button className="mobile-menu-item mobile-theme-btn" onClick={() => setTheme("day")}><i className="fa fa-sun-o"></i> 亮色</button>
            <button className="mobile-menu-item mobile-theme-btn" onClick={() => setTheme("night")}><i className="fa fa-moon-o"></i> 暗色</button>
            <button className="mobile-menu-item mobile-theme-btn" onClick={() => setTheme("default")}><i className="fa fa-desktop"></i> 默认</button>
            <div className="mobile-menu-divider"></div>
            {user && (
              <button className="mobile-menu-item" onClick={logout}><i className="fa fa-sign-out"></i> 退出登录</button>
            )}
          </div>
        </div>
      </header>

      {/* 赞赏弹窗 */}
      {showDonate && (
        <div id="donate-modal" className="donate-modal" style={{ display: "flex" }}>
          <div className="donate-overlay" onClick={() => setShowDonate(false)}></div>
          <div className="donate-card">
            <button className="donate-close" onClick={() => setShowDonate(false)}>&times;</button>
            <h3 className="donate-title"><i className="fa fa-heart"></i> 赞赏支持</h3>
            <p className="donate-subtitle">个人自发投喂，不为项目收益</p>
            <div className="donate-qr-wrap">
              <img src="/assets/img/help.png" alt="赞赏码" />
            </div>
            <p className="donate-tip">你的支持是我持续创作的动力 ❤️</p>
          </div>
        </div>
      )}

      {/* 版本投票弹窗 */}
      {showVote && (
        <div id="version-vote-modal" className="donate-modal" style={{ display: "flex" }}>
          <div className="donate-overlay" onClick={() => setShowVote(false)}></div>
          <div className="donate-card">
            <button className="donate-close" onClick={() => setShowVote(false)}>&times;</button>
            <h3 className="donate-title"><i className="fa fa-random"></i> 版本选择</h3>
            <p className="donate-subtitle">V2 新版本已上线，欢迎体验并投出你的一票</p>
            <a className="version-vote-link" href="https://v2.yjlt.top" target="_blank" rel="noopener noreferrer">
              <i className="fa fa-external-link"></i> 前往 V2 新版本 (v2.yjlt.top)
            </a>
            <div className="version-vote-options">
              <button className="version-vote-btn v1" onClick={() => submitVote("v1")}>
                <i className="fa fa-check-square-o"></i> V1 旧版
              </button>
              <button className="version-vote-btn v2" onClick={() => submitVote("v2")}>
                <i className="fa fa-star"></i> V2 新版
              </button>
            </div>
            <p className="version-vote-stats" id="version-vote-stats">
              {voteStats ? `V1: ${voteStats.v1} 票 | V2: ${voteStats.v2} 票` : "加载中..."}
            </p>
            <p className="version-vote-tip">已登录按账号记录，游客按 IP 记录，可随时改投</p>
          </div>
        </div>
      )}

      {/* Bug 举报弹窗 */}
      {showBug && <BugReportDialog onClose={() => setShowBug(false)} />}
    </>
  );
}

function BugReportDialog({ onClose }: { onClose: () => void }) {
  const { show } = useCenterCard();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [steps, setSteps] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim() || !detail.trim()) return;
    setSubmitting(true);
    try {
      await miscApi.reportBug({ title, detail, steps, contact, page_url: window.location.href });
      show(<p style={{ textAlign: "center" }}>Bug 提交成功，感谢反馈！</p>);
      onClose();
    } catch (e: any) {
      show(<p style={{ textAlign: "center" }}>{e.message}</p>);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id="bug-modal" className="donate-modal" style={{ display: "flex" }}>
      <div className="donate-overlay" onClick={onClose}></div>
      <div className="donate-card" style={{ maxWidth: 520 }}>
        <button className="donate-close" onClick={onClose}>&times;</button>
        <h3 className="donate-title"><i className="fa fa-bug"></i> Bug 报告</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <input className="report-detail-input" placeholder="标题（必填）" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="report-detail-input textarea" placeholder="问题详情（必填）" rows={4} maxLength={5000} value={detail} onChange={(e) => setDetail(e.target.value)} />
          <textarea className="report-detail-input textarea" placeholder="复现步骤（可选）" rows={3} maxLength={3000} value={steps} onChange={(e) => setSteps(e.target.value)} />
          <input className="report-detail-input" placeholder="联系方式（可选）" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} />
          <button className="report-submit" disabled={submitting} onClick={submit}>
            {submitting ? "提交中..." : "提交"}
          </button>
        </div>
      </div>
    </div>
  );
}
