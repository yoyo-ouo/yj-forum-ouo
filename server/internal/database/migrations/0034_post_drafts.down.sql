-- 先移除草稿媒体引用，避免回滚后 media_references 残留指向不存在的 owner。
DELETE FROM media_references WHERE owner_type = 'post_draft';
DROP TABLE IF EXISTS post_drafts;
