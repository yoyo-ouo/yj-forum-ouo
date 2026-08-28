import Link from "next/link";
import Header from "@/components/Header";
export default function PersonalPage() {
  return (
    <>
      <Header />
      <div className="wiki-page">
        <div className="wiki-header"><h2>罗小黑战记个人开发</h2><h6 style={{ color: "red" }}>未经授权禁止商用！！</h6></div>
        <div className="wiki-container">
          <Link href="/WIKI/Personal/mouse" className="wiki-card">
            <div className="wiki-card-image"><img src="/assets/img/mouse_banner.png" alt="" className="WIKIWithBarkground" /></div>
            <div className="wiki-card-content"><h3>鼠标</h3><p>Liunx</p><span className="wiki-card-link">查看详情 &rarr;</span></div>
          </Link>
          <Link href="/WIKI/Personal/Live2D" className="wiki-card">
            <div className="wiki-card-image"><img src="/assets/img/AndSoOn.png" alt="Live2D动作预览" className="WIKIWithBarkground" /></div>
            <div className="wiki-card-content"><h3>罗小黑Live2D模型(不可下载)</h3><p></p><span className="wiki-card-link">查看详情 &rarr;</span></div>
          </Link>
        </div>
        <div className="wiki-footer"><p>更多内容持续更新中...</p></div>
      </div>
    </>
  );
}
