import { categoryColor, categoryLabel } from "@/lib/constants";

/** 分类徽章(彩色胶囊,颜色取自 CATEGORY_COLORS) */
export default function CategoryBadge({
  category,
  className = "post-card-category",
}: {
  category?: string;
  className?: string;
}) {
  const catColor = categoryColor(category);
  return (
    <span className={className} style={{ background: `${catColor}22`, color: catColor }}>
      {categoryLabel(category)}
    </span>
  );
}
