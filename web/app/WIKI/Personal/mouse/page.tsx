import Link from "next/link";
import Header from "@/components/Header";
export default function MouseIndexPage() {
  return (
    <div style={{ paddingTop: "70px" }}>
      <Header />
      <div className="wiki-page">
        <div className="wiki-header"><h2>罗小黑战记鼠标</h2><h6 style={{ color: "red" }}>未经授权禁止商用！！</h6></div>
        <div className="wiki-container">
          <Link href="/WIKI/Personal/mouse/Liunx" className="wiki-card">
            <div className="wiki-card-image"><img src="/assets/img/mouse_banner.png" alt="" className="WIKIWithBarkground" /></div>
            <div className="wiki-card-content"><h3>Liunx版</h3><p></p><span className="wiki-card-link">查看详情 &rarr;</span></div>
          </Link>
          <a href="" className="wiki-card">
            <div className="wiki-card-image"><img src="/assets/img/AndSoOn.png" alt="" className="WIKIWithBarkground" /></div>
            <div className="wiki-card-content"><h3>等待更新</h3><p></p><span className="wiki-card-link">查看详情 &rarr;</span></div>
          </a>
        </div>
        <div className="wiki-footer"><p>更多内容持续更新中...</p></div>
      </div>
    </div>
  );
}
