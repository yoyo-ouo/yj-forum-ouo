-- 草稿发布幂等键：同一草稿（draft_id）重复发布（如响应丢失后重试）时返回同一个 post_id，
-- 避免网络超时/重复点击产生两条内容相同的帖子。草稿本身在发布事务内删除，故单独存映射。
CREATE TABLE IF NOT EXISTS post_publish_keys (
    draft_id VARCHAR(64) PRIMARY KEY,
    post_id VARCHAR(64) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_publish_keys_post ON post_publish_keys (post_id);
CREATE INDEX IF NOT EXISTS idx_post_publish_keys_user_created ON post_publish_keys (user_id, created_at DESC);
