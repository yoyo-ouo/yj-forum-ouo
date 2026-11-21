package database

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"yj-forum/server/internal/models"
)

var batchPreviewSeq int64

func batchTestPayload(name string) *models.CharacterSheetPayload {
	return &models.CharacterSheetPayload{
		Name:          name,
		Guild:         models.CharacterGuildRef{Mode: "none"},
		ImageMediaIDs: []string{},
		Abilities:     []models.CharacterAbility{},
		Quotes:        []models.CharacterQuoteInput{},
	}
}

func insertBatchPreview(t *testing.T, db *DB, userID, contentHash string, count int, createdAt, expiresAt time.Time) string {
	t.Helper()
	hash := fmt.Sprintf("%064x", atomic.AddInt64(&batchPreviewSeq, 1))
	_, err := db.Exec(context.Background(), `INSERT INTO character_batch_previews
		(token_hash, user_id, content_hash, item_count, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)`, hash, userID, contentHash, count, createdAt, expiresAt)
	if err != nil {
		t.Fatalf("insert batch preview: %v", err)
	}
	return hash
}

func countUserSheets(t *testing.T, db *DB, userID string) int {
	t.Helper()
	var n int
	if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM character_sheets WHERE user_id = $1`, userID).Scan(&n); err != nil {
		t.Fatalf("count character_sheets: %v", err)
	}
	return n
}

func seedUserSheets(t *testing.T, db *DB, userID string, n int) {
	t.Helper()
	_, err := db.Exec(context.Background(), `INSERT INTO character_sheets (id, user_id, status)
		SELECT $1 || '-SEED-' || g, $1, 0 FROM generate_series(1, $2) AS g`, userID, n)
	if err != nil {
		t.Fatalf("seed character_sheets: %v", err)
	}
}

func TestCreateCharacterSheetsBatchCreatesDraftsAndReplays(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	uid := newTestUser(t, db)

	const hash = "content-hash-1"
	tokenHash := insertBatchPreview(t, db, uid, hash, 2, time.Now().Add(-5*time.Second), time.Now().Add(10*time.Minute))

	res, err := db.CreateCharacterSheetsBatch(ctx, CharacterBatchSubmit{
		TokenHash: tokenHash, UserID: uid, ContentHash: hash,
		Identifiers: []string{"A", "B"},
		Payloads:    []*models.CharacterSheetPayload{batchTestPayload("白夜"), batchTestPayload("黑夜")},
	})
	if err != nil {
		t.Fatalf("batch create: %v", err)
	}
	if res.Replayed {
		t.Fatal("first submit must not be replayed")
	}
	if len(res.Result.Items) != 2 || res.Result.Items[0].Identifier != "A" {
		t.Fatalf("items = %+v", res.Result.Items)
	}
	if res.Result.Quota.Used != 2 || res.Result.Quota.Max != CharacterMaxPerUser || res.Result.Quota.Remaining != CharacterMaxPerUser-2 {
		t.Fatalf("quota = %+v", res.Result.Quota)
	}

	var status int
	if err := db.QueryRow(ctx, `SELECT status FROM character_sheets WHERE id = $1`, res.Result.Items[0].ID).Scan(&status); err != nil {
		t.Fatalf("load sheet: %v", err)
	}
	if status != 0 {
		t.Fatalf("batch sheet status = %d, want draft 0", status)
	}
	var drafts int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM character_sheet_drafts d
		JOIN character_sheets s ON s.id = d.sheet_id WHERE s.user_id = $1`, uid).Scan(&drafts); err != nil {
		t.Fatalf("count drafts: %v", err)
	}
	if drafts != 2 {
		t.Fatalf("drafts = %d, want 2", drafts)
	}

	// 同一凭证重复提交：回放首次结果，不新增数据
	replay, err := db.CreateCharacterSheetsBatch(ctx, CharacterBatchSubmit{
		TokenHash: tokenHash, UserID: uid, ContentHash: hash,
		Identifiers: []string{"A", "B"},
		Payloads:    []*models.CharacterSheetPayload{batchTestPayload("白夜"), batchTestPayload("黑夜")},
	})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !replay.Replayed || replay.Result.Items[0].ID != res.Result.Items[0].ID {
		t.Fatalf("replay = %+v", replay)
	}
	if got := countUserSheets(t, db, uid); got != 2 {
		t.Fatalf("sheets after replay = %d, want 2", got)
	}
}

func TestCreateCharacterSheetsBatchQuotaAtomic(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	uid := newTestUser(t, db)
	seedUserSheets(t, db, uid, CharacterMaxPerUser-1)

	const hash = "content-hash-quota"
	tokenHash := insertBatchPreview(t, db, uid, hash, 2, time.Now().Add(-5*time.Second), time.Now().Add(10*time.Minute))
	_, err := db.CreateCharacterSheetsBatch(ctx, CharacterBatchSubmit{
		TokenHash: tokenHash, UserID: uid, ContentHash: hash,
		Identifiers: []string{"A", "B"},
		Payloads:    []*models.CharacterSheetPayload{batchTestPayload("白夜"), batchTestPayload("黑夜")},
	})
	if !errors.Is(err, ErrCharacterSheetLimit) {
		t.Fatalf("err = %v, want ErrCharacterSheetLimit", err)
	}
	if got := countUserSheets(t, db, uid); got != CharacterMaxPerUser-1 {
		t.Fatalf("sheets after failed batch = %d, want %d", got, CharacterMaxPerUser-1)
	}
	var drafts int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM character_sheet_drafts d
		JOIN character_sheets s ON s.id = d.sheet_id WHERE s.user_id = $1`, uid).Scan(&drafts); err != nil {
		t.Fatalf("count drafts: %v", err)
	}
	if drafts != 0 {
		t.Fatalf("drafts after failed batch = %d, want 0", drafts)
	}
}

func TestCreateCharacterSheetsBatchTokenBinding(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	uid := newTestUser(t, db)
	other := newTestUser(t, db)
	payload := []*models.CharacterSheetPayload{batchTestPayload("白夜")}

	// 未满 3 秒
	hash := "content-too-early"
	token := insertBatchPreview(t, db, uid, hash, 1, time.Now(), time.Now().Add(10*time.Minute))
	if _, err := db.CreateCharacterSheetsBatch(ctx, CharacterBatchSubmit{
		TokenHash: token, UserID: uid, ContentHash: hash, Identifiers: []string{"A"}, Payloads: payload,
	}); !errors.Is(err, ErrCharacterBatchTooEarly) {
		t.Fatalf("too early err = %v", err)
	}

	// 过期
	hash = "content-expired"
	token = insertBatchPreview(t, db, uid, hash, 1, time.Now().Add(-20*time.Minute), time.Now().Add(-10*time.Minute))
	if _, err := db.CreateCharacterSheetsBatch(ctx, CharacterBatchSubmit{
		TokenHash: token, UserID: uid, ContentHash: hash, Identifiers: []string{"A"}, Payloads: payload,
	}); !errors.Is(err, ErrCharacterBatchTokenExpired) {
		t.Fatalf("expired err = %v", err)
	}

	// 跨用户 / 内容摘要不匹配
	hash = "content-owner"
	token = insertBatchPreview(t, db, uid, hash, 1, time.Now().Add(-5*time.Second), time.Now().Add(10*time.Minute))
	if _, err := db.CreateCharacterSheetsBatch(ctx, CharacterBatchSubmit{
		TokenHash: token, UserID: other, ContentHash: hash, Identifiers: []string{"A"}, Payloads: payload,
	}); !errors.Is(err, ErrCharacterBatchTokenInvalid) {
		t.Fatalf("other user err = %v", err)
	}
	if _, err := db.CreateCharacterSheetsBatch(ctx, CharacterBatchSubmit{
		TokenHash: token, UserID: uid, ContentHash: "different", Identifiers: []string{"A"}, Payloads: payload,
	}); !errors.Is(err, ErrCharacterBatchTokenInvalid) {
		t.Fatalf("content hash err = %v", err)
	}

	if got := countUserSheets(t, db, uid); got != 0 {
		t.Fatalf("sheets = %d, want 0", got)
	}
}

func TestCreateCharacterSheetConcurrentQuota(t *testing.T) {
	db := testDB(t)
	uid := newTestUser(t, db)
	seedUserSheets(t, db, uid, CharacterMaxPerUser-5)

	const attempts = 10
	var ok, limited int32
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := db.CreateCharacterSheet(context.Background(), uid)
			switch {
			case err == nil:
				atomic.AddInt32(&ok, 1)
			case errors.Is(err, ErrCharacterSheetLimit):
				atomic.AddInt32(&limited, 1)
			default:
				t.Errorf("unexpected err: %v", err)
			}
		}()
	}
	wg.Wait()

	if ok != 5 || limited != attempts-5 {
		t.Fatalf("ok=%d limited=%d, want 5/%d", ok, limited, attempts-5)
	}
	if got := countUserSheets(t, db, uid); got != CharacterMaxPerUser {
		t.Fatalf("final count = %d, want %d", got, CharacterMaxPerUser)
	}
}

func TestCreateCharacterSheetsBatchConcurrentTokens(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	uid := newTestUser(t, db)
	seedUserSheets(t, db, uid, CharacterMaxPerUser-5)

	makeSubmit := func(hash string, n int, letter string) CharacterBatchSubmit {
		payloads := make([]*models.CharacterSheetPayload, n)
		ids := make([]string, n)
		for i := 0; i < n; i++ {
			payloads[i] = batchTestPayload(fmt.Sprintf("角色-%s-%d", letter, i))
			ids[i] = fmt.Sprintf("%s%d", letter, i)
		}
		return CharacterBatchSubmit{
			TokenHash: insertBatchPreview(t, db, uid, hash, n, time.Now().Add(-5*time.Second), time.Now().Add(10*time.Minute)),
			UserID:    uid, ContentHash: hash, Identifiers: ids, Payloads: payloads,
		}
	}

	a := makeSubmit("concurrent-a", 4, "A")
	b := makeSubmit("concurrent-b", 3, "B")

	var ok, limited int32
	var wg sync.WaitGroup
	for _, in := range []CharacterBatchSubmit{a, b} {
		wg.Add(1)
		go func(sub CharacterBatchSubmit) {
			defer wg.Done()
			if _, err := db.CreateCharacterSheetsBatch(ctx, sub); err != nil {
				if errors.Is(err, ErrCharacterSheetLimit) {
					atomic.AddInt32(&limited, 1)
					return
				}
				t.Errorf("unexpected err: %v", err)
				return
			}
			atomic.AddInt32(&ok, 1)
		}(in)
	}
	wg.Wait()

	if ok != 1 || limited != 1 {
		t.Fatalf("ok=%d limited=%d, want 1/1", ok, limited)
	}
	if got := countUserSheets(t, db, uid); got > CharacterMaxPerUser {
		t.Fatalf("final count = %d exceeds max %d", got, CharacterMaxPerUser)
	}
}
