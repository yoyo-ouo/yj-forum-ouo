-- 设定记录表（角色设定卡）：
--   character_sheets        已公开内容（status: 0 草稿 / 1 已公开 / 2 管理员下架）
--   character_sheet_drafts  一份未发布的编辑副本（JSONB，发布时摊平到各子表）
--   *_abilities/_images/_quotes  已公开内容的子表
--   *_likes                 点赞去重表
-- 会馆「非真实人员」不写入 guild_members（该表 user_id 为主键、一人一馆），
-- 由成员查询 UNION 已公开且 guild_id 命中的设定派生。

CREATE TABLE IF NOT EXISTS character_sheets (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status SMALLINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  name VARCHAR(24) NOT NULL DEFAULT '',
  alias VARCHAR(24) NOT NULL DEFAULT '',
  title VARCHAR(24) NOT NULL DEFAULT '',
  gender SMALLINT NOT NULL DEFAULT 0,
  age VARCHAR(32) NOT NULL DEFAULT '',
  build VARCHAR(32) NOT NULL DEFAULT '',
  species VARCHAR(32) NOT NULL DEFAULT '',
  identity VARCHAR(32) NOT NULL DEFAULT '',
  description_html TEXT NOT NULL DEFAULT '',
  avatar_media_id VARCHAR(64) NOT NULL DEFAULT '',
  guild_id INTEGER NULL REFERENCES guilds(id) ON DELETE SET NULL,
  guild_custom_name VARCHAR(64) NOT NULL DEFAULT '',
  quotes_visible BOOLEAN NOT NULL DEFAULT FALSE,
  like_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_sheets_user
  ON character_sheets (user_id, status, updated_at DESC);
-- 列表/搜索/彩蛋都按 (status, updated_at) 过滤+排序
CREATE INDEX IF NOT EXISTS idx_character_sheets_status_updated
  ON character_sheets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_character_sheets_guild
  ON character_sheets (guild_id) WHERE guild_id IS NOT NULL AND status = 1;


-- 能力：category 为六大系之一（御灵系/生灵系/锁御系/造物系/心灵系/空间系），detail 为自由文本
CREATE TABLE IF NOT EXISTS character_sheet_abilities (
  id BIGSERIAL PRIMARY KEY,
  sheet_id VARCHAR(64) NOT NULL REFERENCES character_sheets(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  category VARCHAR(16) NOT NULL,
  detail VARCHAR(64) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_character_sheet_abilities_sheet
  ON character_sheet_abilities (sheet_id, sort_order);

CREATE TABLE IF NOT EXISTS character_sheet_images (
  sheet_id VARCHAR(64) NOT NULL REFERENCES character_sheets(id) ON DELETE CASCADE,
  media_id VARCHAR(64) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sheet_id, media_id)
);

CREATE TABLE IF NOT EXISTS character_sheet_quotes (
  id BIGSERIAL PRIMARY KEY,
  sheet_id VARCHAR(64) NOT NULL REFERENCES character_sheets(id) ON DELETE CASCADE,
  content VARCHAR(160) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_sheet_quotes_sheet
  ON character_sheet_quotes (sheet_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_character_sheet_quotes_pool
  ON character_sheet_quotes (sheet_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS character_sheet_likes (
  id BIGSERIAL PRIMARY KEY,
  sheet_id VARCHAR(64) NOT NULL REFERENCES character_sheets(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sheet_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_character_sheet_likes_user
  ON character_sheet_likes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS character_sheet_drafts (
  sheet_id VARCHAR(64) PRIMARY KEY REFERENCES character_sheets(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 注册引导：存量用户回填为「已提示」，只有迁移之后注册的新用户会看到一次性引导
ALTER TABLE users ADD COLUMN IF NOT EXISTS character_prompt_seen_at TIMESTAMPTZ NULL;
UPDATE users SET character_prompt_seen_at = now() WHERE character_prompt_seen_at IS NULL;
