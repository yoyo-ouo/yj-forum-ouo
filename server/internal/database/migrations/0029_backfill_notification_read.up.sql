-- 已读策略统一：通知未读数改为以 notifications.is_read 为准。
-- 依据旧的分类 last_read_at 回填历史通知，避免升级后未读数突增。
UPDATE notifications n
SET is_read = TRUE, read_at = COALESCE(n.read_at, n.created_at)
FROM message_read_state s
WHERE s.user_id = n.user_id
  AND n.created_at <= s.last_read_at
  AND (
    (s.category = 'likes' AND n.type IN ('post_like', 'comment_like'))
    OR (s.category = 'comments' AND n.type IN ('post_comment', 'comment_reply'))
    OR (s.category = 'system' AND n.type = 'system')
  );
