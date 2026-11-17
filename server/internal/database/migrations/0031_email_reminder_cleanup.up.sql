-- 下线「你关注的 xxx 发帖了」与「xxx 评论了你」邮件提醒：
-- 将尚未发送的存量邮件置为死信，避免部署后 worker 继续投递；
-- 同时清理不再被消费的 fanout 任务。
UPDATE email_outbox
SET status = 3,
    last_error = '邮件提醒功能已下线'
WHERE status IN (0, 1)
  AND (subject LIKE '%发布了新帖%'
    OR subject LIKE '%收到新回复%'
    OR subject LIKE '%你的帖子收到新评论%');

DELETE FROM email_fanout_jobs;
