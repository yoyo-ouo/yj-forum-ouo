package database

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
)

// newTestGuild 插入一个测试会馆，测试结束级联清理（含申请记录）。
func newTestGuild(t *testing.T, db *DB) int64 {
	t.Helper()
	key := GenID("TG")
	var id int64
	err := db.QueryRow(context.Background(), `INSERT INTO guilds (slug, name) VALUES ($1, $2) RETURNING id`, key, key).Scan(&id)
	if err != nil {
		t.Fatalf("insert test guild: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM guilds WHERE id = $1", id)
	})
	return id
}

// 全局唯一：待审 A 时申请 B 被唯一索引拒绝；撤回 A 后可改投 B。
func TestGlobalPendingJoinRequestUnique(t *testing.T) {
	db := testDB(t)
	uid := newTestUser(t, db)
	g1 := newTestGuild(t, db)
	g2 := newTestGuild(t, db)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if _, err := db.CreateJoinRequest(ctx, g1, uid, "想加入一馆"); err != nil {
		t.Fatalf("申请一馆: %v", err)
	}
	if _, err := db.CreateJoinRequest(ctx, g2, uid, "想加入二馆"); !IsUniqueViolation(err) {
		t.Fatalf("跨馆待审应命中唯一约束，实际 err=%v", err)
	}

	pending, err := db.GetPendingJoinRequestByUser(ctx, uid)
	if err != nil {
		t.Fatalf("查询全局待审: %v", err)
	}
	if pending == nil || pending.Request == nil || pending.Guild == nil {
		t.Fatalf("全局待审结果不完整: %+v", pending)
	}
	if pending.Guild.ID != g1 || pending.Request.Reason != "想加入一馆" {
		t.Fatalf("待审应指向一馆，实际 guild=%d reason=%q", pending.Guild.ID, pending.Request.Reason)
	}

	// 撤回后可立即改投其他会馆
	if ok, err := db.CancelJoinRequest(ctx, g1, uid); err != nil || !ok {
		t.Fatalf("撤回一馆申请 = (%v,%v)，期望 (true,nil)", ok, err)
	}
	if _, err := db.CreateJoinRequest(ctx, g2, uid, "改投二馆"); err != nil {
		t.Fatalf("撤回后改投: %v", err)
	}
	pending, err = db.GetPendingJoinRequestByUser(ctx, uid)
	if err != nil || pending == nil || pending.Guild == nil {
		t.Fatalf("改投后查询: pending=%+v err=%v", pending, err)
	}
	if pending.Guild.ID != g2 {
		t.Fatalf("改投后待审应指向二馆，实际 %d", pending.Guild.ID)
	}
}

// 并发提交不同会馆：最终应只有一条 status=0。
func TestGlobalPendingJoinRequestConcurrent(t *testing.T) {
	db := testDB(t)
	uid := newTestUser(t, db)
	guilds := []int64{newTestGuild(t, db), newTestGuild(t, db)}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	const workers = 8
	var wg sync.WaitGroup
	results := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := db.CreateJoinRequest(ctx, guilds[i%len(guilds)], uid, fmt.Sprintf("并发 %d", i))
			if err != nil && !IsUniqueViolation(err) {
				results <- err
			}
		}(i)
	}
	wg.Wait()
	close(results)
	for err := range results {
		t.Fatalf("并发提交出现非唯一冲突错误: %v", err)
	}

	var pending int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM guild_join_requests WHERE user_id = $1 AND status = 0`, uid).Scan(&pending); err != nil {
		t.Fatalf("统计待审: %v", err)
	}
	if pending != 1 {
		t.Fatalf("并发后待审条数 = %d，期望 1", pending)
	}
}

// 迁移 0037 数据收敛：旧规则下同一用户跨馆两条待审，升级后只保留最新一条，其余置为已撤回。
func TestMigration0037ConvergesPendingRequests(t *testing.T) {
	if testDBErr != nil {
		t.Skipf("PostgreSQL 测试库不可用: %v", testDBErr)
	}
	base := baseTestDSN()
	schema := fmt.Sprintf("test_mig_%d", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Skipf("连接测试库失败: %v", err)
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		admin.Close(ctx)
		t.Fatalf("创建迁移测试 schema: %v", err)
	}
	admin.Close(ctx)
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if conn, err := pgx.Connect(c, base); err == nil {
			_, _ = conn.Exec(c, "DROP SCHEMA IF EXISTS "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
			conn.Close(c)
		}
	})

	dsn, err := dsnWithSearchPath(base, schema)
	if err != nil {
		t.Fatalf("拼接 schema DSN: %v", err)
	}
	pgDSN := dsn
	if i := strings.Index(pgDSN, "://"); i > 0 {
		pgDSN = "pgx5" + pgDSN[i:]
	}
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		t.Fatalf("读取内嵌迁移: %v", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, pgDSN)
	if err != nil {
		t.Fatalf("初始化迁移器: %v", err)
	}
	defer m.Close()

	// 升到 0036（不含本次迁移），构造旧规则下的跨馆双待审
	if err := m.Migrate(36); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		t.Fatalf("迁移到 0036: %v", err)
	}
	db, err := New(ctx, dsn)
	if err != nil {
		t.Fatalf("连接迁移测试库: %v", err)
	}

	uid := GenID("TU")
	if _, err := db.Exec(ctx, `INSERT INTO users (id, name, avatar, email, password, email_verified)
		VALUES ($1, $1, '', $2, 'x', 1)`, uid, uid+"@example.test"); err != nil {
		t.Fatalf("插入迁移测试用户: %v", err)
	}
	var g1, g2 int64
	key1, key2 := GenID("TG"), GenID("TG")
	if err := db.QueryRow(ctx, `INSERT INTO guilds (slug, name) VALUES ($1,$1) RETURNING id`, key1).Scan(&g1); err != nil {
		t.Fatalf("插入会馆一: %v", err)
	}
	if err := db.QueryRow(ctx, `INSERT INTO guilds (slug, name) VALUES ($1,$1) RETURNING id`, key2).Scan(&g2); err != nil {
		t.Fatalf("插入会馆二: %v", err)
	}
	var oldID, newID int64
	if err := db.QueryRow(ctx, `INSERT INTO guild_join_requests (guild_id, user_id, status, reason) VALUES ($1,$2,0,'旧待审') RETURNING id`, g1, uid).Scan(&oldID); err != nil {
		t.Fatalf("插入旧待审: %v", err)
	}
	if err := db.QueryRow(ctx, `INSERT INTO guild_join_requests (guild_id, user_id, status, reason) VALUES ($1,$2,0,'新待审') RETURNING id`, g2, uid).Scan(&newID); err != nil {
		t.Fatalf("插入新待审: %v", err)
	}
	db.Close()

	// 升级到 0037：收敛数据 + 新建全局唯一索引
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		t.Fatalf("迁移到 0037: %v", err)
	}

	check, err := New(ctx, dsn)
	if err != nil {
		t.Fatalf("重连迁移测试库: %v", err)
	}
	defer check.Close()

	var oldStatus, newStatus int
	var note string
	if err := check.QueryRow(ctx, `SELECT status, handled_note FROM guild_join_requests WHERE id = $1`, oldID).Scan(&oldStatus, &note); err != nil {
		t.Fatalf("校验旧待审: %v", err)
	}
	if err := check.QueryRow(ctx, `SELECT status FROM guild_join_requests WHERE id = $1`, newID).Scan(&newStatus); err != nil {
		t.Fatalf("校验新待审: %v", err)
	}
	if oldStatus != 3 || !strings.Contains(note, "同时仅允许一个会馆申请") {
		t.Fatalf("旧待审应收敛为已撤回并带系统备注，实际 status=%d note=%q", oldStatus, note)
	}
	if newStatus != 0 {
		t.Fatalf("最新待审应保留，实际 status=%d", newStatus)
	}

	var newIdx, oldIdx int
	if err := check.QueryRow(ctx, `SELECT COUNT(*) FROM pg_indexes WHERE schemaname = $1 AND indexname = 'uq_guild_join_requests_pending_user'`, schema).Scan(&newIdx); err != nil {
		t.Fatalf("查询新索引: %v", err)
	}
	if err := check.QueryRow(ctx, `SELECT COUNT(*) FROM pg_indexes WHERE schemaname = $1 AND indexname = 'uq_guild_join_requests_pending'`, schema).Scan(&oldIdx); err != nil {
		t.Fatalf("查询旧索引: %v", err)
	}
	if newIdx != 1 || oldIdx != 0 {
		t.Fatalf("索引状态 = 新%d/旧%d，期望 1/0", newIdx, oldIdx)
	}
}
