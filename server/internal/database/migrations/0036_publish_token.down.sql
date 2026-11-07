DROP INDEX IF EXISTS idx_post_publish_keys_user_token;
ALTER TABLE post_publish_keys DROP COLUMN IF EXISTS publish_token;
ALTER TABLE post_drafts DROP COLUMN IF EXISTS publish_token;
