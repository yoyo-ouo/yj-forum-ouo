-- 回滚 0037：恢复「按会馆 + 用户」去重。
-- 说明：旧索引 (guild_id, user_id) 允许同一用户在不同会馆各有一条待审，
-- 因此回滚后既有多条跨馆待审数据仍合法（无需先收敛）；旧代码只检查本馆待审，可安全运行。
DROP INDEX IF EXISTS uq_guild_join_requests_pending_user;
CREATE UNIQUE INDEX uq_guild_join_requests_pending
    ON guild_join_requests(guild_id, user_id) WHERE status = 0;
