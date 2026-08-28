import WikiCard from "@/components/ui/WikiCard";

export default function WikiIndexPage() {
  return (
    <>
      <div className="wiki-page">
        <div className="wiki-header"><h2>罗小黑战记 Wiki</h2></div>
        <div className="wiki-container">
          <WikiCard href="/WIKI/GuanFang" img="/assets/img/714aed796653e9135b7c24cebe3960c712fa808156cc-hJpr4m_fw658.webp" title="官方" desc="官方发布的内容信息" />
          <WikiCard href="/WIKI/Personal" img="/assets/img/R-C.jpg" title="个人" desc="用户分享的个人创作" />
        </div>
        <div className="wiki-footer"><p>更多内容持续更新中...</p></div>
      </div>
    </>
  );
}
