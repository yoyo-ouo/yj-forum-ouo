-- ============================================================================
-- 妖精论坛 v2.1.0 → 2.2.0 数据库升级脚本（幂等，可重复执行）
--
-- 适用：已经跑过 v2.1.0（schema_migrations = 36）的库。
-- 内容：0037 入馆申请全局单一待审 + 0038 角色批量预览凭证。
--
-- 用法（生产请先备份）：
--   pg_dump -Fc "$DATABASE_URL" > yj_forum_before_2.2.0.dump
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/upgrade-2.2.0.sql
--
-- 说明：
--   1. 全程单事务；任一步失败自动回滚，不会留下半套表。
--   2. 所有 DDL 都带 IF NOT EXISTS；dirty=true 时也可直接跑（用于修复上次
--      迁移失败留下的半成品），成功后会把 schema_migrations 落到 38。
--   3. 若库版本低于 36，请先执行 scripts/upgrade-2.1.0.sql，不要跳过。
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
  IF v < 36 THEN
    RAISE EXCEPTION '当前 schema_migrations=%（低于 36），请先完成 v2.1.0 的迁移，再执行本脚本', v;
  END IF;
  IF v > 38 THEN
    RAISE EXCEPTION '当前 schema_migrations=%（高于 38），本脚本不适用于更新的库', v;
  END IF;
  RAISE NOTICE '当前 schema_migrations=% dirty=%', v, d;

  SELECT string_agg(u.t, ', ' ORDER BY u.t) INTO missing
  FROM unnest(ARRAY[
    'users','character_sheets','character_sheet_drafts','guild_join_requests'
  ]) AS u(t)
  WHERE to_regclass('public.' || u.t) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '缺少依赖表：%。请先完成 v2.1.0 的迁移', missing;
  END IF;
END $$;

-- ── 1. 0037 入馆申请全局单一待审 ──────────────────────────────────────
-- 旧规则允许同一用户在不同会馆各有一条待审。保留 id 最大（最近提交）的一条，
-- 其余置为已撤回（status=3）并写系统备注，避免后续唯一索引创建失败。
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id DESC) AS rn
    FROM guild_join_requests
    WHERE status = 0
)
UPDATE guild_join_requests r
SET status = 3,
    handled_note = '系统：同时仅允许一个会馆申请，已自动撤回'
FROM ranked
WHERE r.id = ranked.id AND ranked.rn > 1;

DROP INDEX IF EXISTS uq_guild_join_requests_pending;
CREATE UNIQUE INDEX IF NOT EXISTS uq_guild_join_requests_pending_user
    ON guild_join_requests(user_id) WHERE status = 0;

-- ── 2. 0038 角色批量添加预览凭证 ─────────────────────────────────────
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

-- ── 3. 版本落点 ────────────────────────────────────────────────────────
-- golang-migrate 只认 schema_migrations 的单行记录；本脚本已按顺序完成 0037~0038，
-- 因此把它落到 38。若中途失败会整体回滚，不会执行到这里。
DELETE FROM schema_migrations;
INSERT INTO schema_migrations (version, dirty) VALUES (38, FALSE);

DO $$
BEGIN
  RAISE NOTICE '升级完成：schema_migrations=38（v2.2.0）';
END $$;

COMMIT;

SELECT version, dirty FROM schema_migrations;
