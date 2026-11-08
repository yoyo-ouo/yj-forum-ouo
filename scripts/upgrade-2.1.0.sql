-- ============================================================================
-- 妖精论坛 v2.0.0 → 2.1.0 数据库升级脚本（幂等，可重复执行）
--
-- 适用：已经跑过 v2.0.0（schema_migrations = 27 或 28）的库。
-- 内容：0028 media_variants + 0029~0036 的全部前向变更。
--
-- 用法（生产请先备份）：
--   pg_dump -Fc "$DATABASE_URL" > yj_forum_before_2.1.0.dump
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/upgrade-2.1.0.sql
--
-- 说明：
--   1. 全程单事务；任一步失败自动回滚，不会留下半套表。
--   2. 所有 DDL 都带 IF NOT EXISTS；dirty=true 时也可直接跑（用于修复上次
--      迁移失败留下的半成品），成功后会把 schema_migrations 落到 36。
--   3. 若库版本低于 27，请先按 docs/migration-baseline.md 完成 v2.0.0 迁移，
--      不要直接执行本脚本。
--   4. 大表建索引可能较久；lock_timeout 15s、statement_timeout 15min，
--      可按需在文件顶部调整。
--   5. 执行前请先停掉 Go 服务（避免和启动迁移并发），并在低峰期执行。
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '15min';

-- ── 0. 预检：版本与依赖对象 ─────────────────────────────────────────────
DO $$
DECLARE
  v BIGINT;
  d BOOLEAN;
  missing TEXT;
BEGIN
  IF to_regclass('public.schema_migrations') IS NULL THEN
    RAISE EXCEPTION '找不到 schema_migrations：这不是 golang-migrate 管理的库，请先按 docs/migration-baseline.md 建立基线';
  END IF;

  SELECT version, dirty INTO v, d FROM schema_migrations LIMIT 1;
  IF v IS NULL THEN
    RAISE EXCEPTION 'schema_migrations 为空，无法判断当前版本';
  END IF;
  IF v < 27 THEN
    RAISE EXCEPTION '当前 schema_migrations=%（低于 27），请先完成 v2.0.0 的迁移，再执行本脚本', v;
  END IF;
  IF v > 36 THEN
    RAISE EXCEPTION '当前 schema_migrations=%（高于 36），本脚本不适用于更新的库', v;
  END IF;
  RAISE NOTICE '当前 schema_migrations=% dirty=%', v, d;

  SELECT string_agg(u.t, ', ' ORDER BY u.t) INTO missing
  FROM unnest(ARRAY[
    'users','posts','comments','guilds','guild_articles','guide_nodes',
    'broadcast_notices','notifications','bug_reports','email_outbox',
    'email_fanout_jobs','media_assets'
  ]) AS u(t)
  WHERE to_regclass('public.' || u.t) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '缺少依赖表：%。请先完成 v2.0.0 的迁移', missing;
  END IF;

  SELECT string_agg(t || '.' || c, ', ' ORDER BY t, c) INTO missing
  FROM (VALUES
    ('users','avatar'), ('users','password_changed_at'),
    ('posts','id'), ('posts','content'),
    ('comments','post_id'), ('comments','user_id'), ('comments','status'),
    ('comments','created_at'), ('comments','parent_id'),
    ('guilds','intro'), ('guilds','intro_page_content'), ('guilds','leader_page_content'),
    ('guild_articles','content'), ('guild_articles','summary'),
    ('guide_nodes','content'), ('broadcast_notices','body_html'),
    ('notifications','payload'), ('bug_reports','detail'), ('bug_reports','steps')
  ) AS req(t, c)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = req.t AND column_name = req.c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '缺少依赖字段：%。请先完成 v2.0.0 的迁移', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'payload' AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'notifications.payload 不是 JSONB，无法执行 0029 的媒体 URL 迁移';
  END IF;
END $$;

-- ── 1. 0028 媒体变体 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media_variants (
  media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  object_key TEXT NOT NULL DEFAULT '',
  bucket TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  width INT NOT NULL DEFAULT 0,
  height INT NOT NULL DEFAULT 0,
  size BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, variant)
);

-- ── 2. 0029 历史媒体 URL 迁移（/api/v1/media/ → /ov2/api/media/） ──────
UPDATE posts
SET content = replace(content, '/api/v1/media/', '/ov2/api/media/')
WHERE content LIKE '%/api/v1/media/%';

UPDATE comments
SET content = replace(content, '/api/v1/media/', '/ov2/api/media/')
WHERE content LIKE '%/api/v1/media/%';

UPDATE guild_articles
SET content = replace(content, '/api/v1/media/', '/ov2/api/media/'),
    summary = replace(summary, '/api/v1/media/', '/ov2/api/media/')
WHERE content LIKE '%/api/v1/media/%' OR summary LIKE '%/api/v1/media/%';

UPDATE guilds
SET intro = replace(intro, '/api/v1/media/', '/ov2/api/media/'),
    intro_page_content = replace(intro_page_content, '/api/v1/media/', '/ov2/api/media/'),
    leader_page_content = replace(leader_page_content, '/api/v1/media/', '/ov2/api/media/')
WHERE intro LIKE '%/api/v1/media/%'
   OR intro_page_content LIKE '%/api/v1/media/%'
   OR leader_page_content LIKE '%/api/v1/media/%';

UPDATE guide_nodes
SET content = replace(content, '/api/v1/media/', '/ov2/api/media/')
WHERE content LIKE '%/api/v1/media/%';

UPDATE broadcast_notices
SET body_html = replace(body_html, '/api/v1/media/', '/ov2/api/media/')
WHERE body_html LIKE '%/api/v1/media/%';

UPDATE notifications
SET payload = jsonb_set(payload, '{body_html}',
    to_jsonb(replace(payload->>'body_html', '/api/v1/media/', '/ov2/api/media/')))
WHERE payload ? 'body_html' AND payload->>'body_html' LIKE '%/api/v1/media/%';

UPDATE users
SET avatar = replace(avatar, '/api/v1/media/', '/ov2/api/media/')
WHERE avatar LIKE '%/api/v1/media/%';

UPDATE bug_reports
SET detail = replace(detail, '/api/v1/media/', '/ov2/api/media/'),
    steps = replace(steps, '/api/v1/media/', '/ov2/api/media/')
WHERE detail LIKE '%/api/v1/media/%' OR steps LIKE '%/api/v1/media/%';

-- ── 3. 0030 未读/评论列表索引 ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_comments_user_created
  ON comments (user_id, created_at DESC) WHERE status = 1;

CREATE INDEX IF NOT EXISTS idx_comments_parent_status
  ON comments (parent_id) WHERE status = 1;

CREATE INDEX IF NOT EXISTS idx_comments_created_status
  ON comments (created_at DESC) WHERE status = 1;

-- ── 4. 0031 下线邮件提醒：未发邮件置死信，清理 fanout 任务 ─────────
UPDATE email_outbox
SET status = 3,
    last_error = '邮件提醒功能已下线'
WHERE status IN (0, 1)
  AND (subject LIKE '%发布了新帖%'
    OR subject LIKE '%收到新回复%'
    OR subject LIKE '%你的帖子收到新评论%');

DELETE FROM email_fanout_jobs;

-- ── 5. 0032 角色设定卡 ────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS idx_character_sheets_status_updated
  ON character_sheets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_character_sheets_guild
  ON character_sheets (guild_id) WHERE guild_id IS NOT NULL AND status = 1;

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

ALTER TABLE users ADD COLUMN IF NOT EXISTS character_prompt_seen_at TIMESTAMPTZ NULL;
UPDATE users SET character_prompt_seen_at = now() WHERE character_prompt_seen_at IS NULL;

-- ── 6. 0033 帖子内评论列表索引 ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_comments_post_created
  ON comments (post_id, created_at, id) WHERE status = 1;

-- ── 7. 0034 发帖草稿 ────────────────────────────────────────────
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

-- ── 8. 0035 草稿发布幂等键 ─────────────────────
CREATE TABLE IF NOT EXISTS post_publish_keys (
    draft_id VARCHAR(64) PRIMARY KEY,
    post_id VARCHAR(64) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_post_publish_keys_post ON post_publish_keys (post_id);
CREATE INDEX IF NOT EXISTS idx_post_publish_keys_user_created ON post_publish_keys (user_id, created_at DESC);

-- ── 9. 0036 发布幂等 token ─────────────────────────────────────
ALTER TABLE post_drafts ADD COLUMN IF NOT EXISTS publish_token VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE post_publish_keys ADD COLUMN IF NOT EXISTS publish_token VARCHAR(64) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_publish_keys_user_token
    ON post_publish_keys (user_id, publish_token) WHERE publish_token <> '';

-- ── 10. 版本落点 ────────────────────────────────────────────────
-- golang-migrate 只认 schema_migrations 的单行记录；本脚本已按顺序完成 0028~0036，
-- 因此把它落到 36。若中途失败会整体回滚，不会执行到这里。
DELETE FROM schema_migrations;
INSERT INTO schema_migrations (version, dirty) VALUES (36, FALSE);

DO $$
BEGIN
  RAISE NOTICE '升级完成：schema_migrations=36（v2.1.0）';
END $$;

COMMIT;

SELECT version, dirty FROM schema_migrations;
