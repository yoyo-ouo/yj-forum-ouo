// Package queue 实现基于 PostgreSQL 的后台消费者：
// email_outbox（5s/20 条，失败指数退避）与 cache_invalidations（1s/50 条）。
// 粉丝发帖邮件（email_fanout_jobs / follower_post）已按产品需求下线。
package queue

import (
	"context"
	"fmt"
	"log"
	"time"

	"yj-forum/server/internal/database"
	"yj-forum/server/internal/email"
)

const (
	emailBatchSize = 20
	cacheBatchSize = 50

	emailInterval = 5 * time.Second
	cacheInterval = 1 * time.Second

	maxEmailAttempts = 8
)

// CacheInvalidator 缓存失效执行器（生产实现为 *handler.CacheSet，测试可注入 mock）。
type CacheInvalidator interface {
	Invalidate(scope, key string) bool
}

// Start 启动 outbox / cache invalidation 两个消费者，直到 ctx 取消。
// cacheSet 为 nil 时 cache 消费者仍会运行（记录失败并在 5 次后标记死信）。
func Start(ctx context.Context, db *database.DB, mailer *email.Sender, cacheSet CacheInvalidator) {
	if db == nil {
		log.Println("[QUEUE] db 未注入，后台消费者未启动")
		return
	}
	go loop(ctx, emailInterval, func(ctx context.Context) {
		if n, err := ProcessEmailBatch(ctx, db, mailer, emailBatchSize); err != nil {
			log.Printf("[QUEUE] outbox 处理失败: %v", err)
		} else if n > 0 {
			log.Printf("[QUEUE] outbox 已处理 %d 封", n)
		}
	})
	go loop(ctx, cacheInterval, func(ctx context.Context) {
		if n, err := ProcessCacheInvalidations(ctx, db, cacheSet, cacheBatchSize); err != nil {
			log.Printf("[QUEUE] cache 失效处理失败: %v", err)
		} else if n > 0 {
			log.Printf("[QUEUE] cache 失效已处理 %d 条", n)
		}
	})
}

func loop(ctx context.Context, interval time.Duration, fn func(context.Context)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	fn(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fn(ctx)
		}
	}
}

// ProcessEmailBatch 认领并发送一批 outbox 邮件；失败按指数退避回队，超过上限进死信。
func ProcessEmailBatch(ctx context.Context, db *database.DB, mailer *email.Sender, limit int) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("queue: db 为 nil")
	}
	items, err := db.ClaimEmailBatch(ctx, limit)
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, item := range items {
		if mailer == nil {
			_ = db.MarkEmailFailed(ctx, item.ID, "mailer 未注入", retryAt(time.Now(), item.Attempts))
			continue
		}
		ok, sendErr := mailer.Send(item.Subject, item.PlainBody, []string{item.ToEmail}, item.HTMLBody)
		if sendErr != nil {
			if item.Attempts >= maxEmailAttempts {
				_ = db.MarkEmailFailed(ctx, item.ID, sendErr.Error(), time.Time{})
			} else {
				_ = db.MarkEmailFailed(ctx, item.ID, sendErr.Error(), retryAt(time.Now(), item.Attempts))
			}
			continue
		}
		if !ok {
			// SMTP 未启用时 Sender 返回 (false, nil)：标记失败但保留内容，启用后可人工重放
			if item.Attempts >= maxEmailAttempts {
				_ = db.MarkEmailFailed(ctx, item.ID, "SMTP 未启用", time.Time{})
			} else {
				_ = db.MarkEmailFailed(ctx, item.ID, "SMTP 未启用", retryAt(time.Now(), item.Attempts))
			}
			continue
		}
		if err := db.MarkEmailSent(ctx, item.ID); err != nil {
			log.Printf("[QUEUE] 标记邮件已发送失败 id=%d: %v", item.ID, err)
			continue
		}
		sent++
	}
	return sent, nil
}

// retryAt 指数退避：30s * 2^(attempts-1)，上限 1h。
func retryAt(now time.Time, attempts int) time.Time {
	if attempts < 1 {
		attempts = 1
	}
	d := 30 * time.Second << uint(attempts-1)
	if d <= 0 || d > time.Hour {
		d = time.Hour
	}
	return now.Add(d)
}

// ProcessCacheInvalidations 认领并执行 cache_invalidations 指令。
func ProcessCacheInvalidations(ctx context.Context, db *database.DB, cacheSet CacheInvalidator, limit int) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("queue: db 为 nil")
	}
	items, err := db.ClaimCacheInvalidations(ctx, limit)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, item := range items {
		if cacheSet == nil {
			_ = db.MarkCacheInvalidation(ctx, item.ID, "cacheSet 未注入")
			continue
		}
		if !cacheSet.Invalidate(item.Scope, item.Key) {
			_ = db.MarkCacheInvalidation(ctx, item.ID, fmt.Sprintf("未知缓存域 %q", item.Scope))
			continue
		}
		if err := db.MarkCacheInvalidation(ctx, item.ID, ""); err != nil {
			log.Printf("[QUEUE] 标记 cache 失效完成失败 id=%d: %v", item.ID, err)
			continue
		}
		done++
	}
	return done, nil
}
