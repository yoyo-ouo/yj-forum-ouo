-- 角色批量添加：预览凭证。
-- 预览只写这张表（绑定用户 + 原文摘要 + 失效时间），不写任何角色数据；
-- 正式提交在同一事务内锁定凭证行，校验 3 秒等待、重算配额、批量创建并记录结果，
-- 已消费的凭证重复提交时原样回放结果（幂等，避免双击重复创建）。

CREATE TABLE IF NOT EXISTS character_batch_previews (
  token_hash   VARCHAR(64) PRIMARY KEY,
  user_id      VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_hash VARCHAR(64) NOT NULL,
  item_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ NULL,
  result       JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_character_batch_previews_expires
  ON character_batch_previews (expires_at);
