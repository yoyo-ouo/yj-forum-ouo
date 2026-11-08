package database

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

// resetWorldMessages 清空世界频道（测试库独立 schema；用例串行执行）。
func resetWorldMessages(t *testing.T, db *DB) {
	t.Helper()
	ctx := context.Background()
	if _, err := db.Exec(ctx, `DELETE FROM world_messages`); err != nil {
		t.Fatalf("clean world_messages: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM world_messages`)
	})
}

func TestWorldDBListCursors(t *testing.T) {
	db := testDB(t)
	resetWorldMessages(t, db)
	uid := newTestUser(t, db)
	ctx := context.Background()

	ids := make([]int64, 5)
	for i := range ids {
		if err := db.QueryRow(ctx, `INSERT INTO world_messages (sender_id, sender_name, content, content_format)
			VALUES ($1, $2, $3, 'html') RETURNING id`, uid, uid, fmt.Sprintf("m%d", i)).Scan(&ids[i]); err != nil {
			t.Fatalf("insert message %d: %v", i, err)
		}
	}

	// 最新一页（降序），多取一条探测 has_more。
	items, hasMore, err := db.ListWorldMessages(ctx, 0, 0, 2)
	if err != nil {
		t.Fatalf("latest page: %v", err)
	}
	if !hasMore || len(items) != 2 || items[0].ID != ids[4] || items[1].ID != ids[3] {
		t.Fatalf("latest page = %+v hasMore=%v, want [%d,%d]", items, hasMore, ids[4], ids[3])
	}

	// before_id 向下翻页：取 ids[3] 之前的两条。
	items, hasMore, err = db.ListWorldMessages(ctx, ids[3], 0, 2)
	if err != nil {
		t.Fatalf("before page: %v", err)
	}
	if !hasMore || len(items) != 2 || items[0].ID != ids[2] || items[1].ID != ids[1] {
		t.Fatalf("before page = %+v hasMore=%v, want [%d,%d]", items, hasMore, ids[2], ids[1])
	}

	// 最老一条之前：空页、无更多。
	items, hasMore, err = db.ListWorldMessages(ctx, ids[0], 0, 2)
	if err != nil {
		t.Fatalf("before oldest: %v", err)
	}
	if hasMore || len(items) != 0 {
		t.Fatalf("before oldest = %+v hasMore=%v, want empty/false", items, hasMore)
	}

	// after_id 增量（升序）。
	items, hasMore, err = db.ListWorldMessages(ctx, 0, ids[1], 10)
	if err != nil {
		t.Fatalf("after page: %v", err)
	}
	if hasMore || len(items) != 3 || items[0].ID != ids[2] || items[2].ID != ids[4] {
		t.Fatalf("after page = %+v hasMore=%v, want ids[2..4]", items, hasMore)
	}

	// 同时提供时 after_id 优先。
	items, _, err = db.ListWorldMessages(ctx, ids[4], ids[0], 10)
	if err != nil {
		t.Fatalf("after+before: %v", err)
	}
	if len(items) != 4 || items[0].ID != ids[1] {
		t.Fatalf("after+before 应以 after 为准，got %+v", items)
	}

	// after_id 最新之后：空。
	items, hasMore, err = db.ListWorldMessages(ctx, 0, ids[4], 10)
	if err != nil {
		t.Fatalf("after newest: %v", err)
	}
	if hasMore || len(items) != 0 {
		t.Fatalf("after newest = %+v hasMore=%v", items, hasMore)
	}

	// ListWorldAfterID 与 after_id 一致。
	items, err = db.ListWorldAfterID(ctx, ids[2], 10)
	if err != nil {
		t.Fatalf("ListWorldAfterID: %v", err)
	}
	if len(items) != 2 || items[0].ID != ids[3] || items[1].ID != ids[4] {
		t.Fatalf("ListWorldAfterID = %+v, want [%d,%d]", items, ids[3], ids[4])
	}

	// limit 超过 500 被截断（数据量小，不报错且返回全部 5 条）。
	items, _, err = db.ListWorldMessages(ctx, 0, 0, 501)
	if err != nil {
		t.Fatalf("limit clamp: %v", err)
	}
	if len(items) != 5 {
		t.Fatalf("limit 501 截断后返回 %d 条, want 5", len(items))
	}

	// 空结果必须是 JSON 空数组而不是 nil。
	items, _, err = db.ListWorldMessages(ctx, ids[0], 0, 2)
	if err != nil {
		t.Fatalf("empty page: %v", err)
	}
	if items == nil {
		t.Fatal("空页应返回非 nil slice")
	}
}

func TestWorldDBCreateSnapshotAndRateLimit(t *testing.T) {
	db := testDB(t)
	resetWorldMessages(t, db)
	uid := newTestUser(t, db)
	ctx := context.Background()

	// 未入馆：会馆字段为空。
	snap, err := db.GetWorldUserSnapshot(ctx, uid)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snap == nil || snap.UserID != uid || snap.GuildID != "" || snap.GuildName != "" || snap.IsLeader {
		t.Fatalf("未入馆快照 = %+v", snap)
	}

	// 建会馆并设为馆长，验证快照字段。
	var gid int64
	if err := db.QueryRow(ctx, `INSERT INTO guilds (slug, name, leader_user_id) VALUES ($1, $2, $3) RETURNING id`,
		"tw"+uid, "TW"+uid, uid).Scan(&gid); err != nil {
		t.Fatalf("insert guild: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM guild_members WHERE user_id = $1`, uid)
		_, _ = db.Exec(context.Background(), `DELETE FROM guilds WHERE id = $1`, gid)
	})
	if _, err := db.Exec(ctx, `INSERT INTO guild_members (user_id, guild_id) VALUES ($1, $2)`, uid, gid); err != nil {
		t.Fatalf("join guild: %v", err)
	}
	var guildUUID, guildName string
	if err := db.QueryRow(ctx, `SELECT uuid::text, name FROM guilds WHERE id = $1`, gid).Scan(&guildUUID, &guildName); err != nil {
		t.Fatalf("read guild: %v", err)
	}

	id, err := db.CreateWorldMessage(ctx, uid, "<p>hello</p>", "html", nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var (
		name, avatar, gidText, gname string
		isLeader                     bool
	)
	if err := db.QueryRow(ctx, `SELECT sender_name, sender_avatar, guild_id, guild_name, is_leader
		FROM world_messages WHERE id = $1`, id).Scan(&name, &avatar, &gidText, &gname, &isLeader); err != nil {
		t.Fatalf("read created: %v", err)
	}
	if name != uid || avatar != "" || gidText != guildUUID || gname != guildName || !isLeader {
		t.Fatalf("快照 = name=%q avatar=%q guild=%q/%q leader=%v", name, avatar, gidText, gname, isLeader)
	}

	// 2 秒限流：紧接的第二条被拒。
	if _, err := db.CreateWorldMessage(ctx, uid, "<p>again</p>", "html", nil); !errors.Is(err, ErrWorldRateLimited) {
		t.Fatalf("second send err = %v, want ErrWorldRateLimited", err)
	}
}

func TestWorldDBCleanupKeepsNewest(t *testing.T) {
	db := testDB(t)
	resetWorldMessages(t, db)
	ctx := context.Background()

	if _, err := db.Exec(ctx, `INSERT INTO world_messages (sender_id, sender_name, content, content_format)
		SELECT 'TWCLEAN', '', 'x', 'html' FROM generate_series(1, 10050)`); err != nil {
		t.Fatalf("seed messages: %v", err)
	}
	var total int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM world_messages`).Scan(&total); err != nil {
		t.Fatalf("count: %v", err)
	}
	if total != 10050 {
		t.Fatalf("seed total = %d, want 10050", total)
	}

	deleted, err := db.WorldCleanup(ctx)
	if err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if deleted != 50 {
		t.Fatalf("cleanup deleted = %d, want 50", deleted)
	}
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM world_messages`).Scan(&total); err != nil {
		t.Fatalf("count after: %v", err)
	}
	if total != WorldKeepCount {
		t.Fatalf("cleanup 后剩余 %d 条, want %d", total, WorldKeepCount)
	}

	// 恰好保留数：再跑一次不应删除任何行。
	deleted, err = db.WorldCleanup(ctx)
	if err != nil {
		t.Fatalf("cleanup again: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("second cleanup deleted = %d, want 0", deleted)
	}
}

// 创建消息时校验引用父消息：不存在或已删（status != 1）一律拒绝。
func TestWorldDBCreateValidatesParent(t *testing.T) {
	db := testDB(t)
	resetWorldMessages(t, db)
	author := newTestUser(t, db)
	ctx := context.Background()

	missing := int64(9_000_000_000)
	if _, err := db.CreateWorldMessage(ctx, author, "<p>child</p>", "html", &missing); !errors.Is(err, ErrWorldParentNotFound) {
		t.Fatalf("父消息不存在 err = %v, want ErrWorldParentNotFound", err)
	}

	// 直接插入父消息（绕过 2 秒发言限流），合法引用可发布。
	var parentID int64
	if err := db.QueryRow(ctx, `INSERT INTO world_messages (sender_id, sender_name, content, content_format)
		VALUES ($1, $2, '<p>父</p>', 'html') RETURNING id`, author, author).Scan(&parentID); err != nil {
		t.Fatalf("insert parent: %v", err)
	}
	sender := newTestUser(t, db) // 新用户避开 2 秒限流
	childID, err := db.CreateWorldMessage(ctx, sender, "<p>子</p>", "html", &parentID)
	if err != nil || childID == 0 {
		t.Fatalf("合法引用创建失败: id=%d err=%v", childID, err)
	}

	// 父消息软删（status=0）后不可再被引用。
	if _, err := db.Exec(ctx, `UPDATE world_messages SET status = 0 WHERE id = $1`, parentID); err != nil {
		t.Fatalf("soft delete parent: %v", err)
	}
	another := newTestUser(t, db)
	if _, err := db.CreateWorldMessage(ctx, another, "<p>子2</p>", "html", &parentID); !errors.Is(err, ErrWorldParentNotFound) {
		t.Fatalf("父消息已删 err = %v, want ErrWorldParentNotFound", err)
	}
}

// 列表与增量查询都批量附加 parent 摘要；父消息已删或不存在时保持 nil。
func TestWorldDBListAttachesParents(t *testing.T) {
	db := testDB(t)
	resetWorldMessages(t, db)
	uid := newTestUser(t, db)
	ctx := context.Background()

	insert := func(content string, parent *int64, status int) int64 {
		t.Helper()
		var id int64
		if err := db.QueryRow(ctx, `INSERT INTO world_messages
			(sender_id, sender_name, sender_avatar, content, content_format, parent_id, status)
			VALUES ($1, '张三', '/avatar/z.png', $2, 'html', $3, $4) RETURNING id`,
			uid, content, parent, status).Scan(&id); err != nil {
			t.Fatalf("insert message: %v", err)
		}
		return id
	}
	parentID := insert("<p>父消息</p>", nil, 1)
	childID := insert("<p>子消息</p>", &parentID, 1)
	deletedParentID := insert("<p>已删父</p>", nil, 0)
	orphanChildID := insert("<p>引用已删</p>", &deletedParentID, 1)
	plainID := insert("<p>无引用</p>", nil, 1)

	items, _, err := db.ListWorldMessages(ctx, 0, 0, 50)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	byID := make(map[int64]WorldMessage, len(items))
	for _, m := range items {
		byID[m.ID] = m
	}
	child, ok := byID[childID]
	if !ok {
		t.Fatalf("列表缺少子消息 %d", childID)
	}
	if child.Parent == nil {
		t.Fatalf("子消息应附加 parent 摘要: %+v", child)
	}
	p := child.Parent
	if p.ID != parentID || p.SenderName != "张三" || p.SenderAvatar != "/avatar/z.png" ||
		p.Content != "<p>父消息</p>" || p.ContentFormat != "html" || p.CreatedAt.IsZero() {
		t.Fatalf("parent 摘要 = %+v", p)
	}
	if byID[orphanChildID].Parent != nil {
		t.Fatalf("父消息已删时 parent 应为 nil: %+v", byID[orphanChildID].Parent)
	}
	if byID[plainID].Parent != nil {
		t.Fatalf("无引用时 parent 应为 nil: %+v", byID[plainID].Parent)
	}

	// 增量查询（SSE 首包/补发与 poller 广播链路复用）同样附加 parent。
	after, err := db.ListWorldAfterID(ctx, parentID, 50)
	if err != nil {
		t.Fatalf("list after: %v", err)
	}
	var found bool
	for _, m := range after {
		if m.ID != childID {
			continue
		}
		found = true
		if m.Parent == nil || m.Parent.ID != parentID {
			t.Fatalf("增量查询未附加 parent: %+v", m.Parent)
		}
	}
	if !found {
		t.Fatalf("增量查询缺少子消息 %d", childID)
	}

	// 批量读取去重 + 过滤已删/非法 id。
	parents, err := db.GetWorldMessageParents(ctx, []int64{parentID, parentID, deletedParentID, 0, 9_000_000_000})
	if err != nil {
		t.Fatalf("get parents: %v", err)
	}
	if len(parents) != 1 {
		t.Fatalf("父消息 map 应只含 1 条，got %+v", parents)
	}
	if got, ok := parents[parentID]; !ok || got.SenderName != "张三" {
		t.Fatalf("parent 摘要 = %+v ok=%v", got, ok)
	}
}
