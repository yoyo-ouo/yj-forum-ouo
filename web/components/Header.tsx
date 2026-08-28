"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import { miscApi } from "@/lib/api";

// 全局弹窗卡片（WindowsCardWithCenterSreen 等价物）
export function showCenterCard(html: string) {
  const card = document.getElementById("WindowsCardWithCenterSreen");
  const text = document.getElementById("WindowsCardWithCenterSreenText");
  if (!card || !text) return;
  text.innerHTML = html;
  card.style.display = "flex";
  card.classList.add("show");
}

export function hideCenterCard() {
  const card = document.getElementById("WindowsCardWithCenterSreen");
  if (!card) return;
  card.style.display = "none";
  card.classList.remove("show");
}

export default function Header() {
  const { theme, setTheme, user, userId, logout } = useStore();
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

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
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
      showCenterCard(`<div style="text-align:center;padding:12px"><p>投票成功！</p><p>V1: ${r.stats.v1} | V2: ${r.stats.v2}</p></div>`);
    } catch (e: any) {
      showCenterCard(`<p style="text-align:center">${e.message}</p>`);
    }
  };

  const showEasterEgg = async () => {
    try {
      const egg = await miscApi.easterEgg();
      showCenterCard(`<h3 style="margin:0 0 12px">${egg.Name}</h3><div>${egg.Text}</div>`);
    } catch {
      showCenterCard(`<p>彩蛋获取失败</p>`);
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
          {showMobileMenu && (
            <div className="header-mobile-menu" id="headerMobileMenu">
              <Link className="mobile-menu-item" href="/WIKI"><i className="fa fa-book"></i> WIKI</Link>
              <a className="mobile-menu-item" href="//hei.navifox.net"><i className="fa fa-home"></i> 会馆</a>
              <a className="mobile-menu-item" href="https://yaonews.unknownmp.top/" target="_blank" rel="noopener"><i className="fa fa-newspaper-o"></i> 日刊</a>
              <button className="mobile-menu-item" onClick={() => setShowDonate(true)}><i className="fa fa-heart"></i> 赞赏</button>
              <button className="mobile-menu-item" onClick={() => setShowBug(true)}><i className="fa fa-bug"></i> Bug举报</button>
              <button className="mobile-menu-item" onClick={() => setShowVote(true)}><i className="fa fa-random"></i> V2新版本</button>
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
          )}
        </div>
      </header>

      <div id="ui">{/* 页面内容由各 page 渲染 */}</div>

      <div id="footer-spacer"></div>

      <div id="WindowsCardWithCenterSreen">
        <button className="windows-card-close" onClick={hideCenterCard}>&times;</button>
        <div id="WindowsCardWithCenterSreenText" className="windows-card"></div>
      </div>

      <Footer />

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
      showCenterCard(`<p style="text-align:center">Bug 提交成功，感谢反馈！</p>`);
      onClose();
    } catch (e: any) {
      showCenterCard(`<p style="text-align:center">${e.message}</p>`);
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
          <input className="form-editor" placeholder="标题（必填）" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="form-editor" placeholder="问题详情（必填）" rows={4} maxLength={5000} value={detail} onChange={(e) => setDetail(e.target.value)} />
          <textarea className="form-editor" placeholder="复现步骤（可选）" rows={3} maxLength={3000} value={steps} onChange={(e) => setSteps(e.target.value)} />
          <input className="form-editor" placeholder="联系方式（可选）" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} />
          <button className="submit-button" disabled={submitting} onClick={submit}>
            {submitting ? "提交中..." : "提交"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer id="footer">
      <Link href="/privacy" id="FooterPrivacy">隐私</Link>
      <br />
      <br />
      联系方式<br />
      邮箱：3890320020@qq.com<br />
      <a href="https://github.com/crazying-dev">Github（大号）：crazying-dev</a><br />
      小红书：<a href="https://xhslink.com/m/7yCXhVvmCaJ">卡里</a><br />
      站长的个人站点：<a href="https://crazying-dev.top" target="_blank" rel="noopener">crazying-dev.top</a><br />
      公众号：
      <span className="qr-hover-wrap">
        <span id="Footer公众号">悬停扫码</span>
        <img className="qr-img" src="/assets/img/OfficialAccount.jpg" alt="公众号二维码" />
      </span>
      <br />
      <br />
      <span className="footer-disclaimer">
        <i className="fa fa-info-circle"></i> 本二创无官方授权，仅粉丝公益创作
      </span>
      <br />
      <br />
    </footer>
  );
}
