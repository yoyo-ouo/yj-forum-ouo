package database

// 帖子草稿：发帖页自动保存的编辑副本。
//
// 约定：
//   - 草稿独立存 post_drafts，发布时在事务内写入 posts 并删除草稿；
//   - 草稿不进入任何公开读路径（列表/搜索/引用/信息流只查 posts.status=1）；
//   - 草稿图片写 media_references(owner_type='post_draft')，发布时先挂 post 再清草稿引用，
//     避免「删除草稿」把仍被正式帖子使用的素材误置为已删除。

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"yj-forum/server/internal/models"
	"yj-forum/server/internal/sanitize"
)

// postDraftMaxPerUser 每个用户最多保留的草稿数（防刷；产品未要求上限，但需要兜底）。
const postDraftMaxPerUser = 50

var (
	// ErrPostDraftNotFound 草稿不存在或不属于当前用户。
	ErrPostDraftNotFound = errors.New("post_draft_not_found")
	// ErrPostDraftLimit 草稿数量超过上限。
	ErrPostDraftLimit = errors.New("post_draft_limit")
)

// PostDraftInput 保存草稿的字段（Content 为编辑器 HTML，写库前统一净化）。
type PostDraftInput struct {
	Title       string
	Content     string
	Category    string
	GuildID     *int64
	ScheduledAt *time.Time
}

// PostDraftPublishInput 发布草稿的最终字段。
type PostDraftPublishInput struct {
	Title       string
	Content     string
	Category    string
	GuildID     *int64
	PublishedAt *time.Time
}

// CreatePostDraft 新建空草稿（仅在有实际内容时由前端调用）。
func (d *DB) CreatePostDraft(ctx context.Context, userID string) (string, error) {
	var count int
	if err := d.QueryRow(ctx, `SELECT COUNT(*) FROM post_drafts WHERE user_id = $1`, userID).Scan(&count); err != nil {
		return "", err
	}
	if count >= postDraftMaxPerUser {
		return "", ErrPostDraftLimit
	}
	id := GenID("PD")
	if _, err := d.Exec(ctx, `INSERT INTO post_drafts (id, user_id) VALUES ($1, $2)`, id, userID); err != nil {
		return "", err
	}
	return id, nil
}

// SavePostDraft 自动保存（整份覆盖标题/正文/分类/会馆/定时），并同步草稿媒体引用。
// 草稿允许空标题/空正文（用户边写边存），发布时再做严格校验。
func (d *DB) SavePostDraft(ctx context.Context, draftID, userID string, in PostDraftInput) (time.Time, error) {
	content := sanitize.SanitizeRichContent(in.Content)
	var savedAt time.Time
	err := d.Tx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `UPDATE post_drafts
			SET title = $3, content = $4, content_format = 'html', category = $5,
			    guild_id = $6, scheduled_at = $7, updated_at = now()
			WHERE id = $1 AND user_id = $2
			RETURNING updated_at`, draftID, userID, in.Title, content, in.Category, in.GuildID, in.ScheduledAt).Scan(&savedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPostDraftNotFound
		}
		if err != nil {
			return err
		}
		return syncMediaReferencesTx(ctx, tx, "post_draft", draftID, content)
	})
	if err != nil {
		return time.Time{}, err
	}
	return savedAt, nil
}

// GetPostDraft 读取某用户的草稿（含正文）；非本人/不存在统一返回 ErrPostDraftNotFound。
func (d *DB) GetPostDraft(ctx context.Context, draftID, userID string) (*models.PostDraft, error) {
	row := d.QueryRow(ctx, `SELECT pd.id, pd.title, pd.content, pd.content_format, pd.category,
		pd.guild_id, COALESCE(g.uuid::text, ''), COALESCE(g.name, ''), COALESCE(g.theme_color, ''),
		pd.scheduled_at, pd.created_at, pd.updated_at
		FROM post_drafts pd LEFT JOIN guilds g ON g.id = pd.guild_id
		WHERE pd.id = $1 AND pd.user_id = $2`, draftID, userID)
	var out models.PostDraft
	var createdAt, updatedAt, scheduledAt *time.Time
	var guildID *int64
	var guildUUID, guildName, guildTheme string
	if err := row.Scan(&out.ID, &out.Title, &out.Content, &out.ContentFormat, &out.Category,
		&guildID, &guildUUID, &guildName, &guildTheme,
		&scheduledAt, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPostDraftNotFound
		}
		return nil, err
	}
	out.GuildID = guildID
	out.GuildUUID = guildUUID
	out.GuildName = guildName
	out.GuildThemeColor = guildTheme
	out.CreatedAt = createdAt
	out.UpdatedAt = updatedAt
	out.ScheduledAt = scheduledAt
	return &out, nil
}

// ListPostDrafts 我的草稿列表（按最近保存倒序，最多 50 条）。
func (d *DB) ListPostDrafts(ctx context.Context, userID string, limit int) ([]models.PostDraftItem, error) {
	if limit < 1 || limit > postDraftMaxPerUser {
		limit = 20
	}
	rows, err := d.Query(ctx, `SELECT pd.id, pd.title,
		LEFT(regexp_replace(pd.content, '<[^>]+>', '', 'g'), 200) AS summary,
		pd.category, pd.guild_id, COALESCE(g.uuid::text, ''), COALESCE(g.name, ''), COALESCE(g.theme_color, ''),
		pd.scheduled_at, pd.created_at, pd.updated_at
		FROM post_drafts pd LEFT JOIN guilds g ON g.id = pd.guild_id
		WHERE pd.user_id = $1
		ORDER BY pd.updated_at DESC, pd.id DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	drafts := []models.PostDraftItem{}
	for rows.Next() {
		var item models.PostDraftItem
		var guildID *int64
		var created, updated, scheduled *time.Time
		if err := rows.Scan(&item.ID, &item.Title, &item.Summary, &item.Category,
			&guildID, &item.GuildUUID, &item.GuildName, &item.GuildThemeColor,
			&scheduled, &created, &updated); err != nil {
			return nil, err
		}
		item.GuildID = guildID
		item.ScheduledAt = scheduled
		item.CreatedAt = created
		item.UpdatedAt = updated
		drafts = append(drafts, item)
	}
	return drafts, rows.Err()
}

// CleanOldPostPublishKeys 清理超过保留期的发布幂等映射。重试窗口远小于该时长，
// 保留期后删除可避免表随发布量单调增长；软删帖的映射也会随保留期一起被清掉。
func (d *DB) CleanOldPostPublishKeys(ctx context.Context, before time.Time) error {
	_, err := d.Exec(ctx, `DELETE FROM post_publish_keys WHERE created_at < $1`, before)
	return err
}

// CleanStaleEmptyPostDrafts 清理长期既无标题也无正文的空草稿（创建失败/测试残留），
// 避免空记录永久占用 50 条草稿上限。只删除 updated_at 早于 before 的行。
func (d *DB) CleanStaleEmptyPostDrafts(ctx context.Context, before time.Time) error {
	_, err := d.Exec(ctx, `DELETE FROM post_drafts WHERE updated_at < $1 AND title = '' AND content = ''`, before)
	return err
}

// DeletePostDraft 放弃草稿：删除行并清理仅被该草稿引用的媒体。
func (d *DB) DeletePostDraft(ctx context.Context, draftID, userID string) error {
	return d.Tx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM post_drafts WHERE id = $1 AND user_id = $2`, draftID, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrPostDraftNotFound
		}
		return softDeleteUnreferencedMediaTx(ctx, tx, "post_draft", draftID)
	})
}

// publishKeyPostID 查询草稿已发布映射（仅返回仍可见的帖子）；未发布返回 ok=false。
func (d *DB) publishKeyPostID(ctx context.Context, draftID, userID string) (string, bool, error) {
	var postID string
	err := d.QueryRow(ctx, `SELECT k.post_id FROM post_publish_keys k
		JOIN posts p ON p.id = k.post_id AND p.status = 1
		WHERE k.draft_id = $1 AND k.user_id = $2`, draftID, userID).Scan(&postID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return postID, true, nil
}

// publishKeyPostIDTx 事务内查询发布映射（并发发布时另一个事务可能已先提交）。
func publishKeyPostIDTx(ctx context.Context, tx pgx.Tx, draftID, userID string) (string, bool, error) {
	var postID string
	err := tx.QueryRow(ctx, `SELECT k.post_id FROM post_publish_keys k
		JOIN posts p ON p.id = k.post_id AND p.status = 1
		WHERE k.draft_id = $1 AND k.user_id = $2`, draftID, userID).Scan(&postID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return postID, true, nil
}

// PublishPostDraft 发布草稿：事务内写 posts、转挂媒体引用、删除草稿。
// 草稿行加 FOR UPDATE，避免与在途自动保存竞争导致「发布后又被保存回来」；
// 同一草稿的重复发布（响应丢失后重试）通过 post_publish_keys 幂等返回原帖。
func (d *DB) PublishPostDraft(ctx context.Context, draftID, userID string, in PostDraftPublishInput) (string, error) {
	// 幂等快路径：同一草稿已成功发布过，直接返回原帖（不重复奖励灵力/不产生第二条）。
	if existing, ok, err := d.publishKeyPostID(ctx, draftID, userID); err != nil {
		return "", err
	} else if ok {
		return existing, nil
	}

	content := sanitize.SanitizeRichContent(in.Content)
	postID := GenID("PS")
	notified := in.PublishedAt == nil // 立即帖创建即视为已通知；定时帖待补偿任务置 TRUE
	existingPostID := ""
	err := d.Tx(ctx, func(tx pgx.Tx) error {
		var storedDraftID string
		err := tx.QueryRow(ctx, `SELECT id FROM post_drafts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
			draftID, userID).Scan(&storedDraftID)
		if errors.Is(err, pgx.ErrNoRows) {
			// 可能被并发请求先发布成功：再查一次映射，命中则直接返回原帖
			if id, ok, kerr := publishKeyPostIDTx(ctx, tx, draftID, userID); kerr != nil {
				return kerr
			} else if ok {
				existingPostID = id
				return nil
			}
			return ErrPostDraftNotFound
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO posts (id, user_id, title, content, content_format, category, guild_id, published_at, publish_notified)
			VALUES ($1,$2,$3,$4,'html',$5,$6,COALESCE($7, NOW()),$8)`,
			postID, userID, in.Title, content, in.Category, in.GuildID, in.PublishedAt, notified); err != nil {
			return err
		}
		// 幂等键与帖子同事务写入：响应丢失后的重试能找回同一个 post_id。
		if _, err := tx.Exec(ctx, `INSERT INTO post_publish_keys (draft_id, post_id, user_id) VALUES ($1,$2,$3)`,
			draftID, postID, userID); err != nil {
			return err
		}
		// 先建立正式帖引用，再清理草稿引用：仍被正式帖使用的图片不会被置为已删除。
		if err := syncMediaReferencesTx(ctx, tx, "post", postID, content); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM post_drafts WHERE id = $1 AND user_id = $2`, draftID, userID); err != nil {
			return err
		}
		return softDeleteUnreferencedMediaTx(ctx, tx, "post_draft", draftID)
	})
	if err != nil {
		return "", err
	}
	if existingPostID != "" {
		return existingPostID, nil
	}
	return postID, nil
}
