// Command seed 生成基准数据集（三档规模，可直接写入 ouo-postgres-bench）。
//
// 安全约束：目标库名必须以 _bench 结尾；库内已有数据时必须显式 -force。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// 最小合法 JPEG（1x1 灰度），用于媒体读取场景。
const tinyJPEGBase64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="

func main() {
	dsn := flag.String("dsn", os.Getenv("DATABASE_URL"), "基准库连接串（库名必须以 _bench 结尾）")
	scaleName := flag.String("scale", "small", "规模档位：small|medium|large")
	seedVal := flag.Int64("seed", 42, "随机种子（同种子=同数据集）")
	outDir := flag.String("out", "./seed", "ids.json / seed-meta.json 输出目录")
	mediaDir := flag.String("media-dir", envOr("MEDIA_DIR", "/tmp/yj-bench/media"), "媒体文件目录")
	force := flag.Bool("force", false, "库内已有数据时仍然清空重灌")
	flag.Parse()

	sc, ok := scales[*scaleName]
	if !ok {
		log.Fatalf("未知规模档位：%s（可选 small|medium|large）", *scaleName)
	}
	if *dsn == "" {
		log.Fatal("缺少 -dsn 或 DATABASE_URL")
	}
	if err := guardDSN(*dsn); err != nil {
		log.Fatalf("拒绝执行：%v", err)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		log.Fatalf("连接基准库失败：%v", err)
	}
	defer pool.Close()

	var hasSchema bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations')`).Scan(&hasSchema); err != nil {
		log.Fatalf("检查表结构失败：%v", err)
	}
	if !hasSchema {
		log.Fatal("基准库尚未建表：请先执行 make bench-db && make bench-server-start（迁移随启动执行）")
	}

	var userCount int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&userCount)
	if userCount > 0 && !*force {
		log.Fatalf("基准库已有 %d 个用户，继续将清空数据；确认请加 -force", userCount)
	}

	if err := os.MkdirAll(*mediaDir, 0o755); err != nil {
		log.Fatalf("创建媒体目录失败：%v", err)
	}
	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		log.Fatalf("创建输出目录失败：%v", err)
	}

	start := time.Now()
	log.Printf("[seed] 规模=%s users=%d posts=%d comments=%d", sc.Name, sc.Users, sc.Posts, sc.Comments)

	if _, err := pool.Exec(ctx, truncateSQL); err != nil {
		log.Fatalf("清空旧数据失败：%v", err)
	}

	s := &seeder{
		ctx: ctx, pool: pool, rng: newRNG(*seedVal), sc: sc,
		now: time.Now().UTC(), mediaDir: *mediaDir,
		guildUsers: map[int]string{},
		counts:     map[string]int{},
	}
	ids := s.run()

	ids.Scale = sc.Name
	ids.Seed = *seedVal
	ids.BaseURL = envOr("BENCH_BASE_URL", "http://127.0.0.1:8091") + "/ov2/api"
	ids.GeneratedAt = time.Now().UTC().Format(time.RFC3339)

	if err := writeJSON(filepath.Join(*outDir, "ids.json"), ids); err != nil {
		log.Fatalf("写入 ids.json 失败：%v", err)
	}
	if err := os.Chmod(filepath.Join(*outDir, "ids.json"), 0o600); err != nil {
		log.Printf("[seed] 收紧 ids.json 权限失败（不影响功能）：%v", err)
	}
	meta := map[string]any{
		"scale": sc.Name, "seed": *seedVal,
		"duration_seconds": time.Since(start).Seconds(),
		"counts":           s.counts,
		"generated_at":     ids.GeneratedAt,
	}
	if err := writeJSON(filepath.Join(*outDir, "seed-meta.json"), meta); err != nil {
		log.Fatalf("写入 seed-meta.json 失败：%v", err)
	}

	log.Printf("[seed] 完成，耗时 %.1fs；产物：%s/ids.json", time.Since(start).Seconds(), *outDir)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func guardDSN(dsn string) error {
	u, err := url.Parse(dsn)
	if err != nil {
		return fmt.Errorf("无法解析 DSN: %w", err)
	}
	db := strings.TrimPrefix(u.Path, "/")
	if !strings.HasSuffix(db, "_bench") {
		return fmt.Errorf("库名必须以 _bench 结尾（当前：%s）", db)
	}
	if u.Port() != "5433" {
		return fmt.Errorf("基准库端口必须是 5433（当前：%s）", u.Port())
	}
	switch u.Hostname() {
	case "127.0.0.1", "localhost", "::1":
	default:
		return fmt.Errorf("基准库主机必须是 loopback（当前：%s）", u.Hostname())
	}
	return nil
}

// mustJSON 序列化为字符串（用于 JSONB 列）。
func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		logFatalf("JSON 编码失败：%v", err)
	}
	return string(b)
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o644)
}

// truncateSQL 一次性清空所有基准表（CASCADE 处理外键）。
const truncateSQL = `TRUNCATE TABLE
  character_sheet_likes, character_sheet_quotes, character_sheet_images,
  character_sheet_abilities, character_sheet_drafts, character_sheets,
  comment_likes, post_likes, post_favorites, post_reports,
  notifications, message_read_state, chat_messages, chat_members, chat_rooms,
  world_messages, email_fanout_jobs, email_outbox,
  media_references, media_variants, media_assets,
  guild_article_participants, guild_articles, guild_announcements,
  guild_categories, guild_members, guild_join_requests, guilds,
  bug_report_logs, bug_reports, guide_nodes, changelogs,
  sessions, verify_codes, verify_tokens, account_action_limits, altcha_used,
  user_follows, comments, posts, users
RESTART IDENTITY CASCADE`

// IDSet 供 k6 使用的 ID/令牌池。
type IDSet struct {
	Scale       string   `json:"scale"`
	Seed        int64    `json:"seed"`
	BaseURL     string   `json:"base_url"`
	GeneratedAt string   `json:"generated_at"`
	Tokens      []string `json:"tokens"`
	UserIDs     []string `json:"user_ids"`
	PostIDs     []string `json:"post_ids"`
	HotPostIDs  []string `json:"hot_post_ids"`
	CommentIDs  []string `json:"comment_ids"`
	GuildSlugs  []string `json:"guild_slugs"`
	ArticleIDs  []string `json:"article_ids"`
	GuideIDs    []string `json:"guide_ids"`
	MediaIDs    []string `json:"media_ids"`
	SearchTerms []string `json:"search_terms"`
}

type seeder struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	rng      *rand.Rand
	sc       Scale
	now      time.Time
	mediaDir string

	startedAt time.Time

	userIDs     []string
	postIDs     []string
	postTimes   []time.Time
	postLabels  []int // 每帖的评论数（用于挑热点）
	commentIDs  []string
	guildSlugs  []string
	articleIDs  []string
	guideIDs    []string
	mediaIDs    []string
	tokens      []string
	sessionUser []string

	guildUsers map[int]string // guild id -> leader user id
	counts     map[string]int
}
