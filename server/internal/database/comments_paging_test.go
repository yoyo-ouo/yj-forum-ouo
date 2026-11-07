package database

import (
	"context"
	"testing"
	"time"

	"yj-forum/server/internal/models"
)

// assertCommentIDs 对比返回的评论 id 序列（GetPostComments 返回升序）。
func assertCommentIDs(t *testing.T, label string, got []models.Comment, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: 条数 = %d，期望 %d", label, len(got), len(want))
	}
	for i := range want {
		if got[i].ID != want[i] {
			t.Fatalf("%s: 第 %d 条 = %s，期望 %s", label, i, got[i].ID, want[i])
		}
	}
}

// TestGetPostCommentsCursorPaging 游标翻页：首次取最新一批，带 before 取更早一批，无重复无遗漏。
func TestGetPostCommentsCursorPaging(t *testing.T) {
	db := testDB(t)
	uid := newTestUser(t, db)
	postID := newTestPost(t, db, uid, "评论分页测试")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	base := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	ids := make([]string, 0, 7)
	for i := 0; i < 7; i++ {
		id := newTestComment(t, db, postID, uid, "<p>c"+itoa(i)+"</p>", nil)
		if _, err := db.Exec(ctx, `UPDATE comments SET created_at = $2 WHERE id = $1`, id, base.Add(time.Duration(i)*time.Minute)); err != nil {
			t.Fatalf("设置 created_at: %v", err)
		}
		ids = append(ids, id)
	}

	// 第一页 = 最新 3 条（仍按升序返回 → ids[4..6]）
	page1, hasMore, err := db.GetPostComments(ctx, postID, 3, nil)
	if err != nil {
		t.Fatalf("第一页: %v", err)
	}
	if !hasMore {
		t.Fatal("第一页应还有更早的评论")
	}
	assertCommentIDs(t, "第一页", page1, ids[4:7])

	cur, exists, err := db.GetCommentCursor(ctx, page1[0].ID)
	if err != nil || !exists {
		t.Fatalf("取游标: exists=%v err=%v", exists, err)
	}
	page2, hasMore, err := db.GetPostComments(ctx, postID, 3, &cur)
	if err != nil {
		t.Fatalf("第二页: %v", err)
	}
	if !hasMore {
		t.Fatal("第二页应还有更早的评论")
	}
	assertCommentIDs(t, "第二页", page2, ids[1:4])

	cur2, _, err := db.GetCommentCursor(ctx, page2[0].ID)
	if err != nil {
		t.Fatalf("取游标 2: %v", err)
	}
	page3, hasMore, err := db.GetPostComments(ctx, postID, 3, &cur2)
	if err != nil {
		t.Fatalf("第三页: %v", err)
	}
	if hasMore {
		t.Fatal("最后一页不应还有更早评论")
	}
	assertCommentIDs(t, "第三页", page3, ids[0:1])
}

// 同时间戳靠 id 二级排序，保证不重复不漏条。
func TestGetPostCommentsCursorTieBreaker(t *testing.T) {
	db := testDB(t)
	uid := newTestUser(t, db)
	postID := newTestPost(t, db, uid, "评论同秒分页")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	same := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	for i := 0; i < 4; i++ {
		id := newTestComment(t, db, postID, uid, "<p>tie"+itoa(i)+"</p>", nil)
		if _, err := db.Exec(ctx, `UPDATE comments SET created_at = $2 WHERE id = $1`, id, same); err != nil {
			t.Fatalf("设置 created_at: %v", err)
		}
	}

	seen := map[string]bool{}
	page, hasMore, err := db.GetPostComments(ctx, postID, 2, nil)
	for round := 0; ; round++ {
		if err != nil {
			t.Fatalf("第 %d 页: %v", round+1, err)
		}
		if round > 6 {
			t.Fatal("翻页未收敛（可能存在重复游标）")
		}
		for _, c := range page {
			if seen[c.ID] {
				t.Fatalf("重复评论: %s", c.ID)
			}
			seen[c.ID] = true
		}
		if !hasMore {
			break
		}
		cur, ok, cerr := db.GetCommentCursor(ctx, page[0].ID)
		if cerr != nil || !ok {
			t.Fatalf("取游标: ok=%v err=%v", ok, cerr)
		}
		page, hasMore, err = db.GetPostComments(ctx, postID, 2, &cur)
	}
	if len(seen) != 4 {
		t.Fatalf("共取到 %d 条，期望 4 条", len(seen))
	}
}
