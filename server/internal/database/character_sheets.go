package database

// 设定记录（角色设定卡）：已公开内容与草稿副本的读写。
//
// 约定：
//   - character_sheets 存已公开内容（status 0 草稿 / 1 已公开 / 2 管理员下架）；
//   - character_sheet_drafts 存一份 JSONB 编辑副本，发布时在事务内摊平到子表；
//   - 设定图片/头像走 media_assets，草稿也写 media_references（owner_type=character_draft）：
//     一是避免「删除其他内容」时把仍被草稿引用的素材误置为已删除，二是为用户内容删除/注销后的
//     回收提供引用依据（本项目没有「上传后长期无引用」的自动清扫，引用是唯一的判据）。

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"yj-forum/server/internal/models"
	"yj-forum/server/internal/sanitize"
)

// characterMaxPerUser 每个用户最多可创建的角色数（防刷；产品未要求上限，但需要兜底）。
const characterMaxPerUser = 20

var (
	// ErrCharacterSheetNotFound 设定不存在或尚不可见。
	ErrCharacterSheetNotFound = errors.New("character_sheet_not_found")
	// ErrCharacterSheetNotOwner 非本人操作。
	ErrCharacterSheetNotOwner = errors.New("character_sheet_not_owner")
	// ErrCharacterSheetSelfLike 不能给自己的设定点赞。
	ErrCharacterSheetSelfLike = errors.New("character_sheet_self_like")
	// ErrCharacterSheetLimit 角色数量达到上限。
	ErrCharacterSheetLimit = errors.New("character_sheet_limit")
)

const characterSheetColumns = `
	s.id, s.user_id, s.status, s.version, s.name, s.alias, s.title, s.gender,
	s.age, s.build, s.species, s.identity, s.description_html, s.avatar_media_id,
	s.guild_id, s.guild_custom_name, s.quotes_visible, s.like_count,
	s.published_at, s.created_at, s.updated_at,
	COALESCE(u.name, ''), COALESCE(u.avatar, ''), COALESCE(u.prefix, ''),
	COALESCE(g.uuid::text, ''), COALESCE(g.name, ''), COALESCE(g.theme_color, ''),
	d.updated_at`

const characterSheetFrom = `
	FROM character_sheets s
	LEFT JOIN users u ON u.id = s.user_id
	LEFT JOIN guilds g ON g.id = s.guild_id
	LEFT JOIN character_sheet_drafts d ON d.sheet_id = s.id`

// characterMediaURL 构造可供 ExtractMediaIDs 识别的媒体引用 URL。
func characterMediaURL(id string) string { return "/ov2/api/media/" + id }

// characterMediaContent 把描述正文与头像/图片拼成一段可供媒体引用同步的文本。
func characterMediaContent(p *models.CharacterSheetPayload) string {
	if p == nil {
		return ""
	}
	var b strings.Builder
	b.WriteString(p.DescriptionHTML)
	if p.AvatarMediaID != "" {
		b.WriteString("\n")
		b.WriteString(characterMediaURL(p.AvatarMediaID))
	}
	for _, id := range p.ImageMediaIDs {
		if id == "" {
			continue
		}
		b.WriteString("\n")
		b.WriteString(characterMediaURL(id))
	}
	return b.String()
}

// escapeLike 转义 ILIKE 模式中的通配符。
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	s = strings.ReplaceAll(s, "_", `\_`)
	return s
}

type characterRowScanner interface {
	Scan(dest ...any) error
}

func scanCharacterSheet(row characterRowScanner) (*models.CharacterSheet, error) {
	var s models.CharacterSheet
	var guildID *int64
	var draftUpdated *time.Time
	err := row.Scan(
		&s.ID, &s.UserID, &s.Status, &s.Version, &s.Name, &s.Alias, &s.Title, &s.Gender,
		&s.Age, &s.Build, &s.Species, &s.Identity, &s.DescriptionHTML, &s.AvatarMediaID,
		&guildID, &s.GuildCustomName, &s.QuotesVisible, &s.LikeCount,
		&s.PublishedAt, &s.CreatedAt, &s.UpdatedAt,
		&s.OwnerName, &s.OwnerAvatar, &s.OwnerPrefix,
		&s.GuildUUID, &s.GuildName, &s.GuildThemeColor,
		&draftUpdated,
	)
	if err != nil {
		return nil, err
	}
	s.GuildID = guildID
	s.DraftUpdatedAt = draftUpdated
	s.HasDraft = draftUpdated != nil
	if s.AvatarMediaID != "" {
		s.Avatar = characterMediaURL(s.AvatarMediaID)
	}
	s.Abilities = []models.CharacterAbility{}
	s.Images = []string{}
	s.Quotes = []models.CharacterQuote{}
	return &s, nil
}

// attachCharacterDetails 批量加载能力/图片/语录与「我是否点赞」。
func (d *DB) attachCharacterDetails(ctx context.Context, sheets []*models.CharacterSheet, viewerID string) error {
	if len(sheets) == 0 {
		return nil
	}
	ids := make([]string, 0, len(sheets))
	byID := make(map[string]*models.CharacterSheet, len(sheets))
	for _, s := range sheets {
		ids = append(ids, s.ID)
		byID[s.ID] = s
	}

	rows, err := d.Query(ctx,
		`SELECT sheet_id, category, detail FROM character_sheet_abilities WHERE sheet_id = ANY($1) ORDER BY sheet_id, sort_order, id`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var sid string
		var a models.CharacterAbility
		if err := rows.Scan(&sid, &a.Category, &a.Detail); err != nil {
			rows.Close()
			return err
		}
		if s := byID[sid]; s != nil {
			s.Abilities = append(s.Abilities, a)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	imgRows, err := d.Query(ctx,
		`SELECT sheet_id, media_id FROM character_sheet_images WHERE sheet_id = ANY($1) ORDER BY sheet_id, sort_order`, ids)
	if err != nil {
		return err
	}
	for imgRows.Next() {
		var sid, mediaID string
		if err := imgRows.Scan(&sid, &mediaID); err != nil {
			imgRows.Close()
			return err
		}
		if s := byID[sid]; s != nil {
			s.Images = append(s.Images, mediaID)
		}
	}
	imgRows.Close()
	if err := imgRows.Err(); err != nil {
		return err
	}

	qRows, err := d.Query(ctx,
		`SELECT id, sheet_id, content FROM character_sheet_quotes WHERE sheet_id = ANY($1) AND is_active = TRUE ORDER BY sheet_id, sort_order, id`, ids)
	if err != nil {
		return err
	}
	for qRows.Next() {
		var qid int64
		var sid, content string
		if err := qRows.Scan(&qid, &sid, &content); err != nil {
			qRows.Close()
			return err
		}
		if s := byID[sid]; s != nil {
			s.Quotes = append(s.Quotes, models.CharacterQuote{ID: qid, Content: content, IsActive: true})
		}
	}
	qRows.Close()
	if err := qRows.Err(); err != nil {
		return err
	}

	if viewerID == "" {
		return nil
	}
	likeRows, err := d.Query(ctx,
		`SELECT sheet_id FROM character_sheet_likes WHERE user_id = $1 AND sheet_id = ANY($2)`, viewerID, ids)
	if err != nil {
		return err
	}
	defer likeRows.Close()
	for likeRows.Next() {
		var sid string
		if err := likeRows.Scan(&sid); err != nil {
			return err
		}
		if s := byID[sid]; s != nil {
			s.Liked = true
		}
	}
	return likeRows.Err()
}

// syncCharacterMediaTx 同步角色媒体引用，并把「不再被任何内容引用」的旧媒体置为已删除。
// 仅用于角色设定（草稿/正式）；不改动其他内容类型的既有行为。
func syncCharacterMediaTx(ctx context.Context, tx pgx.Tx, ownerType, ownerID, content string) error {
	oldIDs := []string{}
	rows, err := tx.Query(ctx, `SELECT media_id FROM media_references WHERE owner_type = $1 AND owner_id = $2`, ownerType, ownerID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		oldIDs = append(oldIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	if err := syncMediaReferencesTx(ctx, tx, ownerType, ownerID, content); err != nil {
		return err
	}
	if len(oldIDs) == 0 {
		return nil
	}
	_, err = tx.Exec(ctx, `UPDATE media_assets SET status = 0, deleted_at = now()
		WHERE is_legacy = FALSE AND id = ANY($1)
		  AND NOT EXISTS (SELECT 1 FROM media_references mr WHERE mr.media_id = media_assets.id)`, oldIDs)
	return err
}

// GetCharacterDraft 读取草稿负载；不存在时返回 (nil, nil)。
func (d *DB) GetCharacterDraft(ctx context.Context, sheetID string) (*models.CharacterSheetPayload, error) {
	var raw []byte
	err := d.QueryRow(ctx, `SELECT payload FROM character_sheet_drafts WHERE sheet_id = $1`, sheetID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var p models.CharacterSheetPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// ListCharacterSheetsByUser 某用户的设定列表；includeDrafts 为 true 时含草稿/下架。
func (d *DB) ListCharacterSheetsByUser(ctx context.Context, userID, viewerID string, includeDrafts bool) ([]*models.CharacterSheet, error) {
	q := `SELECT ` + characterSheetColumns + characterSheetFrom + ` WHERE s.user_id = $1`
	if !includeDrafts {
		q += ` AND s.status = 1`
	}
	q += ` ORDER BY s.status ASC, s.updated_at DESC, s.id DESC`

	rows, err := d.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	sheets := make([]*models.CharacterSheet, 0, 4)
	for rows.Next() {
		s, err := scanCharacterSheet(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		s.Mine = viewerID != "" && s.UserID == viewerID
		sheets = append(sheets, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := d.attachCharacterDetails(ctx, sheets, viewerID); err != nil {
		return nil, err
	}

	// 仅本人可见草稿内容
	if includeDrafts && viewerID == userID {
		for _, s := range sheets {
			if s.HasDraft {
				p, err := d.GetCharacterDraft(ctx, s.ID)
				if err != nil {
					return nil, err
				}
				s.Draft = p
			}
		}
	}
	return sheets, nil
}

// GetCharacterSheet 读取单个设定。
func (d *DB) GetCharacterSheet(ctx context.Context, sheetID, viewerID string) (*models.CharacterSheet, error) {
	row := d.QueryRow(ctx, `SELECT `+characterSheetColumns+characterSheetFrom+` WHERE s.id = $1`, sheetID)
	s, err := scanCharacterSheet(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCharacterSheetNotFound
	}
	if err != nil {
		return nil, err
	}
	s.Mine = viewerID != "" && s.UserID == viewerID
	if !s.Mine {
		s.HasDraft = false
		s.DraftUpdatedAt = nil
	}
	sheets := []*models.CharacterSheet{s}
	if err := d.attachCharacterDetails(ctx, sheets, viewerID); err != nil {
		return nil, err
	}
	if s.Mine && s.HasDraft {
		p, err := d.GetCharacterDraft(ctx, s.ID)
		if err != nil {
			return nil, err
		}
		s.Draft = p
	}
	return s, nil
}

// CreateCharacterSheet 新建空设定（草稿态）。
func (d *DB) CreateCharacterSheet(ctx context.Context, userID string) (string, error) {
	var count int
	if err := d.QueryRow(ctx, `SELECT COUNT(*) FROM character_sheets WHERE user_id = $1`, userID).Scan(&count); err != nil {
		return "", err
	}
	if count >= characterMaxPerUser {
		return "", ErrCharacterSheetLimit
	}
	id := GenID("CS")
	if _, err := d.Exec(ctx, `INSERT INTO character_sheets (id, user_id, status) VALUES ($1, $2, 0)`, id, userID); err != nil {
		return "", err
	}
	return id, nil
}

// SaveCharacterDraft 自动保存草稿（整份 JSONB），并同步草稿媒体引用。
func (d *DB) SaveCharacterDraft(ctx context.Context, sheetID, userID string, p *models.CharacterSheetPayload) (time.Time, error) {
	if p == nil {
		return time.Time{}, ErrCharacterSheetNotFound
	}
	p.DescriptionHTML = sanitize.SanitizeRichContent(p.DescriptionHTML)
	raw, err := json.Marshal(p)
	if err != nil {
		return time.Time{}, err
	}

	var owner string
	if err := d.QueryRow(ctx, `SELECT user_id FROM character_sheets WHERE id = $1`, sheetID).Scan(&owner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, ErrCharacterSheetNotFound
		}
		return time.Time{}, err
	}
	if owner != userID {
		return time.Time{}, ErrCharacterSheetNotOwner
	}

	err = d.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO character_sheet_drafts (sheet_id, payload, updated_at)
			VALUES ($1, $2, now())
			ON CONFLICT (sheet_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`, sheetID, raw); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE character_sheets SET updated_at = now() WHERE id = $1`, sheetID); err != nil {
			return err
		}
		return syncCharacterMediaTx(ctx, tx, "character_draft", sheetID, characterMediaContent(p))
	})
	if err != nil {
		return time.Time{}, err
	}

	var savedAt time.Time
	_ = d.QueryRow(ctx, `SELECT updated_at FROM character_sheet_drafts WHERE sheet_id = $1`, sheetID).Scan(&savedAt)
	return savedAt, nil
}

// PublishCharacterSheet 发布/发布新版本：事务内摊平到子表 + version+1 + 删草稿。
func (d *DB) PublishCharacterSheet(ctx context.Context, sheetID, userID string, p *models.CharacterSheetPayload) (*models.CharacterSheet, error) {
	if p == nil {
		return nil, ErrCharacterSheetNotFound
	}
	p.DescriptionHTML = sanitize.SanitizeRichContent(p.DescriptionHTML)

	var guildID *int64
	var guildCustom string
	switch p.Guild.Mode {
	case "existing":
		if p.Guild.GuildID > 0 {
			var exists bool
			if err := d.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM guilds WHERE id = $1)`, p.Guild.GuildID).Scan(&exists); err != nil {
				return nil, err
			}
			if exists {
				gid := p.Guild.GuildID
				guildID = &gid
			}
		}
	case "custom":
		guildCustom = strings.TrimSpace(p.Guild.CustomName)
	}

	err := d.Tx(ctx, func(tx pgx.Tx) error {
		var owner string
		if err := tx.QueryRow(ctx, `SELECT user_id FROM character_sheets WHERE id = $1 FOR UPDATE`, sheetID).Scan(&owner); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrCharacterSheetNotFound
			}
			return err
		}
		if owner != userID {
			return ErrCharacterSheetNotOwner
		}

		if _, err := tx.Exec(ctx, `UPDATE character_sheets SET
			status = CASE WHEN status = 2 THEN 2 ELSE 1 END,
			version = version + 1,
			name = $2, alias = $3, title = $4, gender = $5, age = $6, build = $7,
			species = $8, identity = $9, description_html = $10, avatar_media_id = $11,
			guild_id = $12, guild_custom_name = $13, quotes_visible = $14,
			published_at = COALESCE(published_at, now()), updated_at = now()
			WHERE id = $1`,
			sheetID, p.Name, p.Alias, p.Title, p.Gender, p.Age, p.Build,
			p.Species, p.Identity, p.DescriptionHTML, p.AvatarMediaID,
			guildID, guildCustom, p.QuotesVisible); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `DELETE FROM character_sheet_abilities WHERE sheet_id = $1`, sheetID); err != nil {
			return err
		}
		for i, a := range p.Abilities {
			if _, err := tx.Exec(ctx, `INSERT INTO character_sheet_abilities (sheet_id, sort_order, category, detail) VALUES ($1,$2,$3,$4)`,
				sheetID, i, a.Category, a.Detail); err != nil {
				return err
			}
		}

		if _, err := tx.Exec(ctx, `DELETE FROM character_sheet_images WHERE sheet_id = $1`, sheetID); err != nil {
			return err
		}
		for i, mid := range p.ImageMediaIDs {
			if mid == "" {
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO character_sheet_images (sheet_id, media_id, sort_order) VALUES ($1,$2,$3)
				ON CONFLICT (sheet_id, media_id) DO NOTHING`, sheetID, mid, i); err != nil {
				return err
			}
		}

		// 重建语录前记录旧的「单条下架」状态：内容未变的行恢复 is_active=false，
		// 避免作者「发布新版本」时把管理员下架的违规语录静默放回。
		prevInactive := map[string]bool{}
		prevRows, err := tx.Query(ctx, `SELECT content, is_active FROM character_sheet_quotes WHERE sheet_id = $1`, sheetID)
		if err != nil {
			return err
		}
		for prevRows.Next() {
			var content string
			var active bool
			if err := prevRows.Scan(&content, &active); err != nil {
				prevRows.Close()
				return err
			}
			if !active {
				prevInactive[content] = true
			}
		}
		prevRows.Close()
		if err := prevRows.Err(); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `DELETE FROM character_sheet_quotes WHERE sheet_id = $1`, sheetID); err != nil {
			return err
		}
		for i, q := range p.Quotes {
			if strings.TrimSpace(q.Content) == "" {
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO character_sheet_quotes (sheet_id, content, sort_order) VALUES ($1,$2,$3)`,
				sheetID, q.Content, i); err != nil {
				return err
			}
			if prevInactive[q.Content] {
				if _, err := tx.Exec(ctx, `UPDATE character_sheet_quotes SET is_active = FALSE
					WHERE sheet_id = $1 AND content = $2`, sheetID, q.Content); err != nil {
					return err
				}
			}
		}

		if _, err := tx.Exec(ctx, `DELETE FROM character_sheet_drafts WHERE sheet_id = $1`, sheetID); err != nil {
			return err
		}

		// 先把草稿媒体挂到正式 owner，再清理草稿引用，避免误伤仍被引用的媒体。
		if err := syncCharacterMediaTx(ctx, tx, "character", sheetID, characterMediaContent(p)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM media_references WHERE owner_type = 'character_draft' AND owner_id = $1`, sheetID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return d.GetCharacterSheet(ctx, sheetID, userID)
}

// DiscardCharacterDraft 放弃草稿：删除草稿行并清理仅被草稿引用的媒体。
func (d *DB) DiscardCharacterDraft(ctx context.Context, sheetID, userID string) error {
	var owner string
	if err := d.QueryRow(ctx, `SELECT user_id FROM character_sheets WHERE id = $1`, sheetID).Scan(&owner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCharacterSheetNotFound
		}
		return err
	}
	if owner != userID {
		return ErrCharacterSheetNotOwner
	}
	return d.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM character_sheet_drafts WHERE sheet_id = $1`, sheetID); err != nil {
			return err
		}
		return softDeleteUnreferencedMediaTx(ctx, tx, "character_draft", sheetID)
	})
}

// DeleteCharacterSheet 删除设定（级联删除子表），并清理媒体引用。
func (d *DB) DeleteCharacterSheet(ctx context.Context, sheetID, userID string) error {
	return d.Tx(ctx, func(tx pgx.Tx) error {
		var owner string
		if err := tx.QueryRow(ctx, `SELECT user_id FROM character_sheets WHERE id = $1 FOR UPDATE`, sheetID).Scan(&owner); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrCharacterSheetNotFound
			}
			return err
		}
		if owner != userID {
			return ErrCharacterSheetNotOwner
		}
		if _, err := tx.Exec(ctx, `DELETE FROM character_sheets WHERE id = $1`, sheetID); err != nil {
			return err
		}
		if err := softDeleteUnreferencedMediaTx(ctx, tx, "character", sheetID); err != nil {
			return err
		}
		return softDeleteUnreferencedMediaTx(ctx, tx, "character_draft", sheetID)
	})
}

// ToggleCharacterSheetLike 点赞/取消，返回最新状态与计数，以及作者信息（用于通知）。
func (d *DB) ToggleCharacterSheetLike(ctx context.Context, sheetID, userID string) (liked bool, count int, ownerID, name string, err error) {
	err = d.Tx(ctx, func(tx pgx.Tx) error {
		if e := tx.QueryRow(ctx, `SELECT user_id, name FROM character_sheets WHERE id = $1 AND status = 1`, sheetID).Scan(&ownerID, &name); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return ErrCharacterSheetNotFound
			}
			return e
		}
		if ownerID == userID {
			return ErrCharacterSheetSelfLike
		}
		tag, e := tx.Exec(ctx, `DELETE FROM character_sheet_likes WHERE sheet_id = $1 AND user_id = $2`, sheetID, userID)
		if e != nil {
			return e
		}
		if tag.RowsAffected() > 0 {
			liked = false
		} else {
			if _, e := tx.Exec(ctx, `INSERT INTO character_sheet_likes (sheet_id, user_id) VALUES ($1,$2)
				ON CONFLICT (sheet_id, user_id) DO NOTHING`, sheetID, userID); e != nil {
				return e
			}
			liked = true
		}
		if _, e := tx.Exec(ctx, `UPDATE character_sheets
			SET like_count = (SELECT COUNT(*) FROM character_sheet_likes WHERE sheet_id = $1)
			WHERE id = $1`, sheetID); e != nil {
			return e
		}
		return tx.QueryRow(ctx, `SELECT like_count FROM character_sheets WHERE id = $1`, sheetID).Scan(&count)
	})
	return liked, count, ownerID, name, err
}

// SearchCharacterSheets 引用选择器：空关键词返回最新，非空按角色名/别称/称号/作者名模糊匹配。
func (d *DB) SearchCharacterSheets(ctx context.Context, keyword, viewerID string, page, pageSize int) ([]*models.CharacterSheet, bool, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 10
	}
	kw := strings.TrimSpace(keyword)
	like := "%" + escapeLike(kw) + "%"

	rows, err := d.Query(ctx, `SELECT `+characterSheetColumns+characterSheetFrom+`
		WHERE s.status = 1
		  AND ($1 = '' OR s.name ILIKE $2 OR s.alias ILIKE $2
		       OR s.title ILIKE $2 OR COALESCE(u.name, '') ILIKE $2)
		ORDER BY s.updated_at DESC, s.id DESC
		LIMIT $3 OFFSET $4`, kw, like, pageSize+1, (page-1)*pageSize)
	if err != nil {
		return nil, false, err
	}
	sheets := make([]*models.CharacterSheet, 0, pageSize+1)
	for rows.Next() {
		s, err := scanCharacterSheet(rows)
		if err != nil {
			rows.Close()
			return nil, false, err
		}
		sheets = append(sheets, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	hasMore := len(sheets) > pageSize
	if hasMore {
		sheets = sheets[:pageSize]
	}
	if err := d.attachCharacterDetails(ctx, sheets, viewerID); err != nil {
		return nil, false, err
	}
	return sheets, hasMore, nil
}

// ListCharacterEggQuotes 彩蛋语录池：已公开且勾选参与、未被下架的语录。
func (d *DB) ListCharacterEggQuotes(ctx context.Context) ([]models.CharacterEggQuote, error) {
	rows, err := d.Query(ctx, `
		SELECT s.id, s.name, q.content
		FROM character_sheet_quotes q
		JOIN character_sheets s ON s.id = q.sheet_id
		WHERE s.status = 1 AND s.quotes_visible = TRUE AND q.is_active = TRUE
		ORDER BY s.updated_at DESC, q.sort_order, q.id
		LIMIT 500`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.CharacterEggQuote, 0, 32)
	for rows.Next() {
		var q models.CharacterEggQuote
		if err := rows.Scan(&q.SheetID, &q.Name, &q.Text); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// MarkCharacterPromptSeen 标记注册引导已展示（幂等，只写一次）。
func (d *DB) MarkCharacterPromptSeen(ctx context.Context, userID string) error {
	_, err := d.Exec(ctx, `UPDATE users SET character_prompt_seen_at = now()
		WHERE id = $1 AND character_prompt_seen_at IS NULL`, userID)
	return err
}

// CharacterPromptSeen 注册引导是否已展示（用户不存在/查询失败一律视为已展示，避免反复弹窗）。
func (d *DB) CharacterPromptSeen(ctx context.Context, userID string) bool {
	var seen *time.Time
	err := d.QueryRow(ctx, `SELECT character_prompt_seen_at FROM users WHERE id = $1`, userID).Scan(&seen)
	if err != nil {
		return true
	}
	return seen != nil
}
