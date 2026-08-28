-- 妖精论坛 v2 初始迁移：12 张业务表 + sessions + 索引
-- 表结构与 legacy api/config.py 保持一致（含 World 小写表名修正）

CREATE TABLE users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(64) UNIQUE NOT NULL,
    avatar TEXT NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    gender INTEGER DEFAULT 0,
    age VARCHAR(32) DEFAULT '',
    intro TEXT DEFAULT '',
    vip VARCHAR(32) NOT NULL DEFAULT '0',
    prefix VARCHAR(32) DEFAULT '',
    is_banned INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

CREATE TABLE posts (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(64) DEFAULT 'general',
    likes INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE comments (
    id VARCHAR(64) PRIMARY KEY,
    post_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    content TEXT NOT NULL,
    parent_id VARCHAR(64) DEFAULT NULL,
    likes INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

-- 原表名为 World（PG 未加引号时实际小写为 world），此处统一为 world
CREATE TABLE world (
    id SERIAL PRIMARY KEY,
    sender_id VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    parent_id INTEGER DEFAULT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE post_likes (
    id SERIAL PRIMARY KEY,
    post_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE post_favorites (
    id SERIAL PRIMARY KEY,
    post_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_follows (
    id SERIAL PRIMARY KEY,
    follower_id VARCHAR(64) NOT NULL,
    following_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE verify_tokens (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    token_type VARCHAR(32) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE post_reports (
    id SERIAL PRIMARY KEY,
    post_id VARCHAR(64) NOT NULL,
    reporter_id VARCHAR(64) NOT NULL,
    reason VARCHAR(64) NOT NULL,
    detail TEXT DEFAULT '',
    status INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE bug_reports (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    detail TEXT NOT NULL,
    steps TEXT DEFAULT '',
    contact VARCHAR(200) DEFAULT '',
    reporter_id VARCHAR(64) DEFAULT NULL,
    reporter_name VARCHAR(64) DEFAULT '',
    user_agent TEXT DEFAULT '',
    page_url TEXT DEFAULT '',
    status INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE verify_codes (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE version_votes (
    id SERIAL PRIMARY KEY,
    voter_key VARCHAR(128) NOT NULL UNIQUE,
    voter_id VARCHAR(64) DEFAULT NULL,
    voter_name VARCHAR(64) DEFAULT '',
    choice VARCHAR(8) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- v2 新增：服务端会话表（Session Cookie 认证）
CREATE TABLE sessions (
    token VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引（15 + sessions 1）
CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_world_created_at ON world(created_at DESC);
CREATE INDEX idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX idx_post_likes_user_id ON post_likes(user_id);
CREATE INDEX idx_post_favorites_user_id ON post_favorites(user_id);
CREATE INDEX idx_user_follows_follower ON user_follows(follower_id);
CREATE INDEX idx_user_follows_following ON user_follows(following_id);
CREATE INDEX idx_post_reports_post_id ON post_reports(post_id);
CREATE INDEX idx_bug_reports_created_at ON bug_reports(created_at DESC);
CREATE INDEX idx_bug_reports_status ON bug_reports(status);
CREATE INDEX idx_verify_codes_email_purpose ON verify_codes(email, purpose);
CREATE INDEX idx_verify_codes_expires ON verify_codes(expires_at);
CREATE INDEX idx_version_votes_choice ON version_votes(choice);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
