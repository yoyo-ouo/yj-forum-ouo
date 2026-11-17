-- 消息中心未读计数与评论列表按 user/parent/created_at 过滤，补齐索引。
CREATE INDEX IF NOT EXISTS idx_comments_user_created
  ON comments (user_id, created_at DESC) WHERE status = 1;

CREATE INDEX IF NOT EXISTS idx_comments_parent_status
  ON comments (parent_id) WHERE status = 1;

CREATE INDEX IF NOT EXISTS idx_comments_created_status
  ON comments (created_at DESC) WHERE status = 1;
