package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"yj-forum/server/internal/models"
)

// AddComment 添加评论/回复（content 由调用方净化后传入；contentFormat 标记存储形态）。
func (d *DB) AddComment(ctx context.Context, postID, userID, content, contentFormat string, parentID *string) (*models.Comment, error) {
	id := GenID("CM")
	err := d.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO comments (id, post_id, user_id, content, content_format, parent_id) VALUES ($1,$2,$3,$4,$5,$6)`,
			id, postID, userID, content, contentFormat, parentID); err != nil {
			return err
		}
		return syncMediaReferencesTx(ctx, tx, "comment", id, content)
	})
	if err != nil {
		return nil, err
	}
	return d.GetComment(ctx, id)
}

// GetComment 单条评论（JOIN 用户）。
func (d *DB) GetComment(ctx context.Context, id string) (*models.Comment, error) {
	row := d.QueryRow(ctx, `SELECT c.id, c.post_id, c.user_id, c.content, c.content_format, c.parent_id, c.likes, c.status,
		c.created_at, u.name, u.avatar,
		COALESCE(g.name, ''), COALESCE(g.theme_color, ''), COALESCE(g.leader_user_id = c.user_id, false)
		FROM comments c JOIN users u ON c.user_id = u.id
		LEFT JOIN guild_members gm ON gm.user_id = c.user_id
		LEFT JOIN guilds g ON g.id = gm.guild_id
		WHERE c.id = $1`, id)
	var c models.Comment
	var createdAt *time.Time
	err := row.Scan(&c.ID, &c.PostID, &c.UserID, &c.Content, &c.ContentFormat, &c.ParentID, &c.Likes, &c.Status, &createdAt, &c.UserName, &c.UserAvatar,
		&c.UserGuildName, &c.UserGuildThemeColor, &c.UserIsLeader)
	if err != nil {
		return nil, err
	}
	c.CreatedAt = createdAt
	return &c, nil
}

// GetCommentPostAndStatus 查询评论所属帖子与状态（parent_id 回复校验用）；不存在返回 pgx.ErrNoRows。
func (d *DB) GetCommentPostAndStatus(ctx context.Context, id string) (string, int, error) {
	var postID string
	var status int
	err := d.QueryRow(ctx, "SELECT post_id, status FROM comments WHERE id=$1", id).Scan(&postID, &status)
	return postID, status, err
}

// CommentCursor 评论翻页游标（按 created_at + id 稳定定位，用于「加载更早的评论」）。
type CommentCursor struct {
	PostID    string
	CreatedAt time.Time
	ID        string
}

// GetCommentCursor 取某条评论的游标（before_id 定位用）；不存在时 exists=false。
func (d *DB) GetCommentCursor(ctx context.Context, commentID string) (CommentCursor, bool, error) {
	var c CommentCursor
	err := d.QueryRow(ctx, `SELECT post_id, created_at, id FROM comments WHERE id = $1`, commentID).
		Scan(&c.PostID, &c.CreatedAt, &c.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CommentCursor{}, false, nil
	}
	if err != nil {
		return CommentCursor{}, false, err
	}
	return c, true, nil
}

// GetPostComments 按「最新在前」的游标分页取评论，返回结果仍按时间升序（兼容既有渲染顺序）。
//
//	before == nil → 第一页（最新的一批）
//	before != nil → 比游标更早的一批（「加载更早的评论」）
//
// 用 (created_at, id) 元组比较而不是 OFFSET：边看边有人发评论时不会重复或漏条；
// 旧实现 ORDER BY created_at ASC LIMIT 50 只能看到最早的 50 条，新评论永远不出现。
func (d *DB) GetPostComments(ctx context.Context, postID string, limit int, before *CommentCursor) ([]models.Comment, bool, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	args := []any{postID}
	where := "c.post_id = $1 AND c.status = 1"
	if before != nil {
		args = append(args, before.CreatedAt, before.ID)
		where += " AND (c.created_at, c.id) < ($2, $3)"
	}
	// 多取一条用于判断是否还有更早的评论
	args = append(args, limit+1)
	rows, err := d.Query(ctx, `SELECT c.id, c.post_id, c.user_id, c.content, c.content_format, c.parent_id, c.likes, c.status,
		c.created_at, u.name, u.avatar,
		COALESCE(g.name, ''), COALESCE(g.theme_color, ''), COALESCE(g.leader_user_id = c.user_id, false)
		FROM comments c JOIN users u ON c.user_id = u.id
		LEFT JOIN guild_members gm ON gm.user_id = c.user_id
		LEFT JOIN guilds g ON g.id = gm.guild_id
		WHERE `+where+` ORDER BY c.created_at DESC, c.id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	comments := []models.Comment{}
	for rows.Next() {
		var c models.Comment
		var createdAt *time.Time
		if err := rows.Scan(&c.ID, &c.PostID, &c.UserID, &c.Content, &c.ContentFormat, &c.ParentID, &c.Likes, &c.Status, &createdAt, &c.UserName, &c.UserAvatar,
			&c.UserGuildName, &c.UserGuildThemeColor, &c.UserIsLeader); err != nil {
			return nil, false, err
		}
		c.CreatedAt = createdAt
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	hasMore := len(comments) > limit
	if hasMore {
		comments = comments[:limit]
	}
	// 反转为升序：前端沿用「升序 → reverse 展示最新在前」的既有逻辑
	for i, j := 0, len(comments)-1; i < j; i, j = i+1, j-1 {
		comments[i], comments[j] = comments[j], comments[i]
	}
	return comments, hasMore, nil
}

// ChangeCommentLikes 评论点赞计数增减（delta 为 +1/-1），返回最新点赞数。
// 评论不存在或已删除（status=0）时返回 error。
func (d *DB) ChangeCommentLikes(ctx context.Context, commentID string, delta int) (int, error) {
	var likes int
	err := d.QueryRow(ctx,
		`UPDATE comments SET likes = GREATEST(likes + $2, 0) WHERE id = $1 AND status = 1 RETURNING likes`,
		commentID, delta).Scan(&likes)
	if err != nil {
		return 0, err
	}
	return likes, nil
}

// LikeComment 切换评论点赞（去重），返回 (是否点赞, 最新点赞数)。
func (d *DB) LikeComment(ctx context.Context, commentID, userID string) (bool, int, error) {
	var liked bool
	var likes int
	err := d.Tx(ctx, func(tx pgx.Tx) error {
		var count int
		if err := tx.QueryRow(ctx, "SELECT COUNT(*) FROM comment_likes WHERE comment_id=$1 AND user_id=$2", commentID, userID).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			if _, err := tx.Exec(ctx, "DELETE FROM comment_likes WHERE comment_id=$1 AND user_id=$2", commentID, userID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, "UPDATE comments SET likes = GREATEST(likes - 1, 0) WHERE id=$1", commentID); err != nil {
				return err
			}
			liked = false
		} else {
			var status int
			if err := tx.QueryRow(ctx, "SELECT status FROM comments WHERE id=$1", commentID).Scan(&status); err != nil {
				return err
			}
			if status != 1 {
				return errCommentUnavailable
			}
			if _, err := tx.Exec(ctx, "INSERT INTO comment_likes (comment_id, user_id) VALUES ($1,$2)", commentID, userID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, "UPDATE comments SET likes = likes + 1 WHERE id=$1", commentID); err != nil {
				return err
			}
			liked = true
		}
		return tx.QueryRow(ctx, "SELECT COALESCE(likes,0) FROM comments WHERE id=$1", commentID).Scan(&likes)
	})
	return liked, likes, err
}

// HasLikedComment 是否已点赞评论。
func (d *DB) HasLikedComment(ctx context.Context, commentID, userID string) bool {
	var n int
	_ = d.QueryRow(ctx, "SELECT COUNT(*) FROM comment_likes WHERE comment_id=$1 AND user_id=$2", commentID, userID).Scan(&n)
	return n > 0
}

// GetLikedCommentIDs 返回用户已点赞的评论 ID 集合（用于批量填充 liked_by_me）。
func (d *DB) GetLikedCommentIDs(ctx context.Context, userID string, commentIDs []string) (map[string]bool, error) {
	liked := make(map[string]bool, len(commentIDs))
	if len(commentIDs) == 0 {
		return liked, nil
	}
	rows, err := d.Query(ctx, `SELECT comment_id FROM comment_likes WHERE user_id = $1 AND comment_id = ANY($2)`, userID, commentIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		liked[id] = true
	}
	return liked, rows.Err()
}

// DeleteComment 软删（仅作者）。
func (d *DB) DeleteComment(ctx context.Context, commentID, userID string) (bool, error) {
	deleted := false
	err := d.Tx(ctx, func(tx pgx.Tx) error {
		var content string
		err := tx.QueryRow(ctx, `SELECT content FROM comments WHERE id = $1 AND user_id = $2 AND status = 1`, commentID, userID).Scan(&content)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE comments SET status = 0 WHERE id = $1 AND user_id = $2`, commentID, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		deleted = true
		return softDeleteUnreferencedMediaTx(ctx, tx, "comment", commentID)
	})
	return deleted, err
}

// GetRepliesToMyComments 我收到的回复。
func (d *DB) GetRepliesToMyComments(ctx context.Context, userID string, page, pageSize int) ([]models.ReplyItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize
	var total int
	_ = d.QueryRow(ctx, `SELECT COUNT(*) FROM comments c
		WHERE c.parent_id IN (SELECT id FROM comments WHERE user_id = $1 AND status = 1)
		AND c.status = 1 AND c.user_id <> $1`, userID).Scan(&total)
	rows, err := d.Query(ctx, `SELECT c.id, c.post_id, c.user_id, c.content, c.content_format, c.parent_id, c.likes, c.status,
		c.created_at, u.name, u.avatar,
		COALESCE(g.name, ''), COALESCE(g.theme_color, ''), COALESCE(g.leader_user_id = c.user_id, false),
		p.title
		FROM comments c JOIN users u ON c.user_id = u.id
		JOIN comments pc ON c.parent_id = pc.id
		JOIN posts p ON c.post_id = p.id
		LEFT JOIN guild_members gm ON gm.user_id = c.user_id
		LEFT JOIN guilds g ON g.id = gm.guild_id
		WHERE pc.user_id = $1 AND c.status = 1 AND c.user_id <> $1
		ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`, userID, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	replies := []models.ReplyItem{}
	for rows.Next() {
		var r models.ReplyItem
		var createdAt *time.Time
		if err := rows.Scan(&r.ID, &r.PostID, &r.UserID, &r.Content, &r.ContentFormat, &r.ParentID, &r.Likes, &r.Status, &createdAt, &r.UserName, &r.UserAvatar,
			&r.UserGuildName, &r.UserGuildThemeColor, &r.UserIsLeader, &r.PostTitle); err != nil {
			return nil, 0, err
		}
		r.CreatedAt = createdAt
		replies = append(replies, r)
	}
	return replies, total, rows.Err()
}

// GetUserComments 用户发表的评论。
// 仅统计所属帖子未删除（p.status = 1）的评论；非本人视角还要求帖子已发布（排除定时帖），
// 避免点进评论后帖子 404。
func (d *DB) GetUserComments(ctx context.Context, userID, viewer string, page, pageSize int) ([]models.ReplyItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	postWhere := "p.status = 1"
	if viewer != userID {
		postWhere += " AND p.published_at <= NOW()"
	}
	var total int
	_ = d.QueryRow(ctx, `SELECT COUNT(*) FROM comments c JOIN posts p ON p.id = c.post_id
		WHERE c.user_id = $1 AND c.status = 1 AND `+postWhere, userID).Scan(&total)
	rows, err := d.Query(ctx, `SELECT c.id, c.post_id, c.user_id, c.content, c.content_format, c.parent_id, c.likes, c.status,
		c.created_at, u.name, u.avatar,
		COALESCE(g.name, ''), COALESCE(g.theme_color, ''), COALESCE(g.leader_user_id = c.user_id, false),
		p.title
		FROM comments c JOIN users u ON c.user_id = u.id
		JOIN posts p ON c.post_id = p.id
		LEFT JOIN guild_members gm ON gm.user_id = c.user_id
		LEFT JOIN guilds g ON g.id = gm.guild_id
		WHERE c.user_id = $1 AND c.status = 1 AND `+postWhere+`
		ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`, userID, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	replies := []models.ReplyItem{}
	for rows.Next() {
		var r models.ReplyItem
		var createdAt *time.Time
		if err := rows.Scan(&r.ID, &r.PostID, &r.UserID, &r.Content, &r.ContentFormat, &r.ParentID, &r.Likes, &r.Status, &createdAt, &r.UserName, &r.UserAvatar,
			&r.UserGuildName, &r.UserGuildThemeColor, &r.UserIsLeader, &r.PostTitle); err != nil {
			return nil, 0, err
		}
		r.CreatedAt = createdAt
		replies = append(replies, r)
	}
	return replies, total, rows.Err()
}
