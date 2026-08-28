import Link from "next/link";
import Header from "@/components/Header";

export default function WikiIndexPage() {
  return (
    <>
      <Header />
      <div className="wiki-page">
        <div className="wiki-header"><h2>罗小黑战记 Wiki</h2></div>
        <div className="wiki-container">
          <Link href="/WIKI/GuanFang" className="wiki-card" id="GuangFang">
            <div className="wiki-card-image">
              <img src="/assets/img/714aed796653e9135b7c24cebe3960c712fa808156cc-hJpr4m_fw658.webp" alt="官方内容" className="WIKIWithBarkground" />
            </div>
            <div className="wiki-card-content"><h3>官方</h3><p>官方发布的内容信息</p><span className="wiki-card-link">查看详情 &rarr;</span></div>
          </Link>
          <Link href="/WIKI/Personal" className="wiki-card" id="Personal">
            <div className="wiki-card-image">
              <img src="/assets/img/R-C.jpg" alt="个人内容" className="WIKIWithBarkground" />
            </div>
            <div className="wiki-card-content"><h3>个人</h3><p>用户分享的个人创作</p><span className="wiki-card-link">查看详情 &rarr;</span></div>
          </Link>
        </div>
        <div className="wiki-footer"><p>更多内容持续更新中...</p></div>
      </div>
    </>
  );
}
