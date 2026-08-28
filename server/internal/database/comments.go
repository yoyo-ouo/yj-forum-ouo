package database

import (
	"context"
	"time"

	"yj-forum/server/internal/models"
)

// AddComment 添加评论/回复。
func (d *DB) AddComment(ctx context.Context, postID, userID, content string, parentID *string) (*models.Comment, error) {
	id := GenID("CM")
	_, err := d.Exec(ctx, `INSERT INTO comments (id, post_id, user_id, content, parent_id) VALUES ($1,$2,$3,$4,$5)`,
		id, postID, userID, SafeHTML(content), parentID)
	if err != nil {
		return nil, err
	}
	return d.GetComment(ctx, id)
}

// GetComment 单条评论（JOIN 用户）。
func (d *DB) GetComment(ctx context.Context, id string) (*models.Comment, error) {
	row := d.QueryRow(ctx, `SELECT c.id, c.post_id, c.user_id, c.content, c.parent_id, c.likes, c.status,
		c.created_at, u.name, u.avatar FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = $1`, id)
	var c models.Comment
	var createdAt *time.Time
	err := row.Scan(&c.ID, &c.PostID, &c.UserID, &c.Content, &c.ParentID, &c.Likes, &c.Status, &createdAt, &c.UserName, &c.UserAvatar)
	if err != nil {
		return nil, err
	}
	c.CreatedAt = createdAt
	return &c, nil
}

// GetPostComments 帖子评论列表。
func (d *DB) GetPostComments(ctx context.Context, postID string, page, pageSize int) ([]models.Comment, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize
	rows, err := d.Query(ctx, `SELECT c.id, c.post_id, c.user_id, c.content, c.parent_id, c.likes, c.status,
		c.created_at, u.name, u.avatar FROM comments c JOIN users u ON c.user_id = u.id
		WHERE c.post_id = $1 AND c.status = 1 ORDER BY c.created_at ASC LIMIT $2 OFFSET $3`,
		postID, pageSize, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var comments []models.Comment
	for rows.Next() {
		var c models.Comment
		var createdAt *time.Time
		if err := rows.Scan(&c.ID, &c.PostID, &c.UserID, &c.Content, &c.ParentID, &c.Likes, &c.Status, &createdAt, &c.UserName, &c.UserAvatar); err != nil {
			return nil, err
		}
		c.CreatedAt = createdAt
		comments = append(comments, c)
	}
	return comments, rows.Err()
}

// DeleteComment 软删（仅作者）。
func (d *DB) DeleteComment(ctx context.Context, commentID, userID string) (bool, error) {
	tag, err := d.Exec(ctx, `UPDATE comments SET status = 0 WHERE id = $1 AND user_id = $2`, commentID, userID)
	return tag > 0, err
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
	rows, err := d.Query(ctx, `SELECT c.id, c.post_id, c.user_id, c.content, c.parent_id, c.likes, c.status,
		c.created_at, u.name, u.avatar, p.title
		FROM comments c JOIN users u ON c.user_id = u.id
		JOIN comments pc ON c.parent_id = pc.id
		JOIN posts p ON c.post_id = p.id
		WHERE pc.user_id = $1 AND c.status = 1 AND c.user_id <> $1
		ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`, userID, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var replies []models.ReplyItem
	for rows.Next() {
		var r models.ReplyItem
		var createdAt *time.Time
		if err := rows.Scan(&r.ID, &r.PostID, &r.UserID, &r.Content, &r.ParentID, &r.Likes, &r.Status, &createdAt, &r.UserName, &r.UserAvatar, &r.PostTitle); err != nil {
			return nil, 0, err
		}
		r.CreatedAt = createdAt
		replies = append(replies, r)
	}
	return replies, total, rows.Err()
}
