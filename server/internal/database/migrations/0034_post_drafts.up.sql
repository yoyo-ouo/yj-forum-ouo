-- 帖子草稿：发帖页自动保存的编辑副本；点击「发布」时才写入 posts 对外可见。
-- 独立表的原因：不依赖「每个读路径都记得过滤 status」来保证草稿不泄漏；
-- 草稿图片写 media_references(owner_type='post_draft')，发布时在事务内转挂到 post。
CREATE TABLE IF NOT EXISTS post_drafts (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    content_format VARCHAR(16) NOT NULL DEFAULT 'html',
    category VARCHAR(64) NOT NULL DEFAULT 'general',
    guild_id INTEGER DEFAULT NULL REFERENCES guilds(id) ON UPDATE CASCADE ON DELETE CASCADE,
    scheduled_at TIMESTAMP DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_drafts_user_updated ON post_drafts (user_id, updated_at DESC);
