-- 全局仅允许 1 条待审入馆申请（任意会馆同一时刻）
-- 背景：去重口径从「按会馆」收紧为「按用户全局」，避免同一用户同时排队多个会馆。

-- 1) 收敛历史数据：旧规则允许同一用户在不同会馆各有一条待审。
--    保留 id 最大（最近提交、最贴近用户当前意愿）的一条，其余置为已撤回（status=3）。
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

-- 2) 唯一索引改为按用户：任意用户全局至多一条待审。
DROP INDEX IF EXISTS uq_guild_join_requests_pending;
CREATE UNIQUE INDEX uq_guild_join_requests_pending_user
    ON guild_join_requests(user_id) WHERE status = 0;
