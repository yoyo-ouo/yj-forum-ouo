-- 历史媒体 URL 迁移：旧 /api/v1/media/<id> → /ov2/api/media/<id>
-- 旧 API 前缀已移除，但历史富文本内容里仍可能保存旧地址，
-- 在删除兼容层后会导致图片/附件 404。

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
