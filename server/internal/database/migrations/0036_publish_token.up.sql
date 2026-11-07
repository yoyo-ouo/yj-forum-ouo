-- 发布幂等 token：编辑器会话级标识，随草稿保存、随发布提交。
-- 即使草稿被删除后自动另存（draft_id 变化），同一 token 仍能找回已创建的帖子，避免重复发帖。
ALTER TABLE post_drafts ADD COLUMN IF NOT EXISTS publish_token VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE post_publish_keys ADD COLUMN IF NOT EXISTS publish_token VARCHAR(64) NOT NULL DEFAULT '';

-- 同一用户的 token 只能对应一个帖子；空 token 不参与唯一约束（兼容旧客户端/旧草稿）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_publish_keys_user_token
    ON post_publish_keys (user_id, publish_token) WHERE publish_token <> '';
