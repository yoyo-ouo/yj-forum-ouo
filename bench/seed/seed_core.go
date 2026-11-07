package main

import (
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *seeder) run() *IDSet {
	s.startedAt = time.Now()
	s.seedUsers()
	s.seedGuilds()
	s.seedPosts()
	s.seedComments()
	s.seedInteractions()
	s.seedWorld()
	s.seedChat()
	s.seedNotifications()
	s.seedMedia()
	s.seedGuides()
	s.seedMisc()
	s.seedCharacterSheets()
	s.finalize()
	return s.buildIDs()
}

// flush 将一批行 COPY 进表（pgx 使用二进制 COPY，速度远高于逐条 INSERT）。
func (s *seeder) flush(table string, cols []string, rows [][]any) {
	if len(rows) == 0 {
		return
	}
	if _, err := s.pool.CopyFrom(s.ctx, pgx.Identifier{table}, cols, pgx.CopyFromRows(rows)); err != nil {
		logFatalf("COPY %s 失败：%v", table, err)
	}
}

func logFatalf(format string, args ...any) {
	log.Fatalf(format, args...)
}

// ---- 用户与会话 ----

func (s *seeder) seedUsers() {
	cols := []string{"id", "name", "avatar", "email", "password", "gender", "age", "intro", "prefix",
		"is_banned", "email_verified", "created_at", "last_login", "spirit", "last_sign_in"}
	rows := make([][]any, 0, s.sc.Users)
	for i := 0; i < s.sc.Users; i++ {
		id := userID(i)
		created := spreadTime(s.rng, s.now.AddDate(-2, 0, 0), s.now.AddDate(0, 0, -1))
		var lastLogin any
		if s.rng.Intn(5) != 0 {
			lastLogin = created.Add(time.Duration(s.rng.Int63n(int64(30 * 24 * time.Hour))))
		}
		var lastSignIn any
		if s.rng.Intn(3) != 0 {
			lastSignIn = s.now.AddDate(0, 0, -s.rng.Intn(30)).Format("2006-01-02")
		}
		rows = append(rows, []any{
			id, nameOf(i), "", fmt.Sprintf("bench%05d@example.test", i), "bench-no-login",
			s.rng.Intn(3), fmt.Sprintf("%d", 16+s.rng.Intn(20)), plainText(s.rng, 5), "", 0, 1,
			created, lastLogin, s.rng.Intn(500), lastSignIn,
		})
		s.userIDs = append(s.userIDs, id)
	}
	s.flush("users", cols, rows)
	s.counts["users"] = len(rows)

	scols := []string{"token", "user_id", "expires_at", "created_at"}
	srows := make([][]any, 0, s.sc.Sessions)
	for i := 0; i < s.sc.Sessions && i < len(s.userIDs); i++ {
		tok := sessionToken(i)
		srows = append(srows, []any{tok, s.userIDs[i], s.now.Add(30 * 24 * time.Hour), s.now.Add(-24 * time.Hour)})
		s.tokens = append(s.tokens, tok)
		s.sessionUser = append(s.sessionUser, s.userIDs[i])
	}
	s.flush("sessions", scols, srows)
	s.counts["sessions"] = len(srows)
}

// ---- 会馆 ----

func (s *seeder) seedGuilds() {
	gcols := []string{"id", "slug", "name", "intro", "logo_file_id", "theme_color",
		"leader_user_id", "leader_bio", "created_at", "updated_at",
		"leader_title", "leader_page_content", "intro_page_content", "intro_cover_file_id"}
	grows := make([][]any, 0, s.sc.Guilds)
	for i := 0; i < s.sc.Guilds; i++ {
		gid := i + 1
		leader := s.userIDs[i%len(s.userIDs)]
		created := spreadTime(s.rng, s.now.AddDate(-2, 0, 0), s.now.AddDate(0, 0, -30))
		grows = append(grows, []any{
			gid, slugOf(i), fmt.Sprintf("基准会馆%03d", i), plainText(s.rng, 8), "",
			themeColors[i%len(themeColors)], leader, plainText(s.rng, 6),
			created, created, "馆长", htmlContent(s.rng, 800, false), htmlContent(s.rng, 1200, false), "",
		})
		s.guildSlugs = append(s.guildSlugs, slugOf(i))
		s.guildUsers[gid] = leader
	}
	s.flush("guilds", gcols, grows)
	s.mustExec(fmt.Sprintf("SELECT setval('guilds_id_seq', %d, true)", len(grows)))
	s.counts["guilds"] = len(grows)

	// 分类：每馆 4 个
	ccols := []string{"guild_id", "name", "sort"}
	var crows [][]any
	for i := 0; i < s.sc.Guilds; i++ {
		for j := 0; j < 4; j++ {
			crows = append(crows, []any{i + 1, fmt.Sprintf("分类%s", string(rune('A'+j))), j})
		}
	}
	s.flush("guild_categories", ccols, crows)
	s.counts["guild_categories"] = len(crows)

	// 成员：每个用户只属于一个会馆（表主键是 user_id）
	mcols := []string{"user_id", "guild_id", "joined_at"}
	mrows := make([][]any, 0, len(s.userIDs))
	for i, uid := range s.userIDs {
		gid := i%s.sc.Guilds + 1
		mrows = append(mrows, []any{uid, gid, spreadTime(s.rng, s.now.AddDate(-1, 0, 0), s.now)})
	}
	s.flush("guild_members", mcols, mrows)
	s.counts["guild_members"] = len(mrows)

	// 公告：每馆 3 条
	acols := []string{"guild_id", "content", "created_at", "updated_at"}
	var arows [][]any
	for i := 0; i < s.sc.Guilds; i++ {
		for j := 0; j < 3; j++ {
			t := spreadTime(s.rng, s.now.AddDate(0, 0, -180), s.now)
			arows = append(arows, []any{i + 1, plainText(s.rng, 10), t, t})
		}
	}
	s.flush("guild_announcements", acols, arows)
	s.counts["guild_announcements"] = len(arows)

	// 文章：每馆 10 篇
	tcols := []string{"id", "guild_id", "title", "summary", "content", "author_user_id", "views",
		"created_at", "updated_at", "content_format", "published_at"}
	var trows [][]any
	for gi := 0; gi < s.sc.Guilds; gi++ {
		for ai := 0; ai < 10; ai++ {
			aid := articleID(gi, ai)
			created := spreadTime(s.rng, s.now.AddDate(-1, 0, 0), s.now)
			trows = append(trows, []any{
				aid, gi + 1, fmt.Sprintf("%s · 会馆文章%d", sentence(s.rng, 3), ai),
				plainText(s.rng, 6), htmlContent(s.rng, 1500+s.rng.Intn(3000), false),
				s.userIDs[s.rng.Intn(len(s.userIDs))], s.rng.Intn(2000),
				created, created, "html", created,
			})
			s.articleIDs = append(s.articleIDs, aid)
		}
	}
	s.flush("guild_articles", tcols, trows)
	s.counts["guild_articles"] = len(trows)

	// 文章参与人
	pcols := []string{"article_id", "user_id"}
	var prows [][]any
	for _, aid := range s.articleIDs {
		seen := map[string]bool{}
		for k := 0; k < 3; k++ {
			uid := s.userIDs[s.rng.Intn(len(s.userIDs))]
			if seen[uid] {
				continue
			}
			seen[uid] = true
			prows = append(prows, []any{aid, uid})
		}
	}
	s.flush("guild_article_participants", pcols, prows)
	s.counts["guild_article_participants"] = len(prows)
}

// ---- 帖子 ----

func (s *seeder) seedPosts() {
	cols := []string{"id", "user_id", "title", "content", "category", "likes", "views", "status",
		"created_at", "updated_at", "guild_id", "content_format", "published_at", "publish_notified"}
	const batch = 5000
	rows := make([][]any, 0, batch)

	for i := 0; i < s.sc.Posts; i++ {
		created := spreadTime(s.rng, s.now.AddDate(-2, 0, 0), s.now.Add(-time.Hour))
		var guildID any
		if s.rng.Intn(10) < 4 {
			guildID = i%s.sc.Guilds + 1
		}
		title := fmt.Sprintf("%s · 第%d篇", sentence(s.rng, 3), i)
		if i%50 == 0 {
			title = "星海 · " + title
		}
		if i%77 == 0 {
			title = "灵质空间 · " + title
		}
		rows = append(rows, []any{
			postID(i), s.userIDs[s.rng.Intn(len(s.userIDs))], title,
			htmlContent(s.rng, 1000+s.rng.Intn(7000), s.rng.Intn(10) == 0),
			categories[i%len(categories)], 0, s.rng.Intn(5000), 1,
			created, created, guildID, "html", created, true,
		})
		s.postIDs = append(s.postIDs, postID(i))
		s.postTimes = append(s.postTimes, created)
		if len(rows) >= batch {
			s.flush("posts", cols, rows)
			rows = rows[:0]
		}
	}
	if len(rows) > 0 {
		s.flush("posts", cols, rows)
	}
	s.counts["posts"] = len(s.postIDs)
}

// ---- 评论 ----

func (s *seeder) seedComments() {
	n := len(s.postIDs)
	counts := powerLawCounts(s.rng, n, s.sc.Comments, 0.85)
	s.postLabels = counts

	cols := []string{"id", "post_id", "user_id", "content", "parent_id", "likes", "status", "created_at", "content_format"}
	const batch = 20000
	rows := make([][]any, 0, batch)

	for p, cnt := range counts {
		if cnt <= 0 {
			continue
		}
		ids := make([]string, 0, cnt)
		base := s.postTimes[p]
		span := int64(s.now.Sub(base))
		if span <= 0 {
			span = 1
		}
		for j := 0; j < cnt; j++ {
			id := commentID(p, j)
			var parent any
			if j > 0 && s.rng.Float64() < 0.30 {
				parent = ids[s.rng.Intn(len(ids))]
			}
			created := base.Add(time.Duration(s.rng.Int63n(span)))
			content := htmlContent(s.rng, 80+s.rng.Intn(420), j%40 == 0)
			rows = append(rows, []any{
				id, s.postIDs[p], s.userIDs[s.rng.Intn(len(s.userIDs))], content, parent, 0, 1, created, "html",
			})
			ids = append(ids, id)
			if len(s.commentIDs) < 20000 && s.rng.Intn(50) == 0 {
				s.commentIDs = append(s.commentIDs, id)
			}
			if len(rows) >= batch {
				s.flush("comments", cols, rows)
				rows = rows[:0]
			}
		}
	}
	if len(rows) > 0 {
		s.flush("comments", cols, rows)
	}
	s.counts["comments"] = s.sc.Comments
}

func (s *seeder) mustExec(sql string) {
	if _, err := s.pool.Exec(s.ctx, sql); err != nil {
		logFatalf("执行失败 %s：%v", sql, err)
	}
}
