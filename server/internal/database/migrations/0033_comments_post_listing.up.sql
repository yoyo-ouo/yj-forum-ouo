-- 评论列表查询（WHERE post_id = $1 AND status = 1 ORDER BY created_at）
-- 目前只有 idx_comments_post_id(post_id)：帖子评论量一大，规划器会退化成
-- 「按 created_at 倒序扫全表再过滤 post_id」或「取到行后额外排序」。
-- 复合索引让帖子内的评论列表直接有序走索引（覆盖等值 + 排序），深翻页也稳定。
CREATE INDEX IF NOT EXISTS idx_comments_post_created
  ON comments (post_id, created_at, id) WHERE status = 1;
