import Link from "next/link";

/** WIKI 卡片(官方/个人/鼠标 共用的 wiki-card 结构),href 为空时为非链接卡片 */
export default function WikiCard({
  href,
  img,
  title,
  desc = "",
  tip = "查看详情 →",
  download = false,
}: {
  href?: string;
  img?: string;
  title: string;
  desc?: string;
  tip?: string;
  download?: boolean;
}) {
  const inner = (
    <>
      {img && (
        <div className="wiki-card-image">
          <img src={img} alt={title} className="WIKIWithBarkground" />
        </div>
      )}
      <div className="wiki-card-content">
        <h3>{title}</h3>
        {desc && <p>{desc}</p>}
        <span className="wiki-card-link">{tip}</span>
      </div>
    </>
  );

  // 下载链接 / 空链接用原生 <a>(支持 download 属性),站内跳转用 Link
  if (href && !download) {
    return (
      <Link href={href} className="wiki-card">
        {inner}
      </Link>
    );
  }
  return (
    <a href={href || ""} className="wiki-card" download={download || undefined}>
      {inner}
    </a>
  );
}
