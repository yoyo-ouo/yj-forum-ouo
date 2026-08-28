package database

import (
	"context"
	"time"

	"yj-forum/server/internal/models"
)

// GetWorldMessages 最近 100 条世界消息。
func (d *DB) GetWorldMessages(ctx context.Context, limit int) ([]models.WorldMessage, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	rows, err := d.Query(ctx, `SELECT id, sender_id, sender_name, content, parent_id, created_at
		FROM world WHERE created_at > NOW() - INTERVAL '5 minutes' ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []models.WorldMessage
	for rows.Next() {
		var m models.WorldMessage
		var createdAt *time.Time
		if err := rows.Scan(&m.ID, &m.SenderID, &m.SenderName, &m.Content, &m.ParentID, &createdAt); err != nil {
			return nil, err
		}
		m.CreatedAt = createdAt
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}

// SendWorldMessage 发送世界消息。
func (d *DB) SendWorldMessage(ctx context.Context, senderID, senderName, content string, parentID *int64) error {
	_, err := d.Exec(ctx, `INSERT INTO world (sender_id, sender_name, content, parent_id) VALUES ($1,$2,$3,$4)`,
		senderID, senderName, SafeHTML(content), parentID)
	return err
}

// GetWorldLastSentAt 该用户上次发送时间（2 秒限速）。
func (d *DB) GetWorldLastSentAt(ctx context.Context, senderID string) (*time.Time, error) {
	var t *time.Time
	err := d.QueryRow(ctx, `SELECT MAX(created_at) FROM world WHERE sender_id = $1`, senderID).Scan(&t)
	return t, err
}
