package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

func (s *seeder) tier(small, medium, large int) int {
	switch s.sc.Name {
	case "small":
		return small
	case "medium":
		return medium
	default:
		return large
	}
}

// ---- 点赞 / 收藏 / 关注 ----

func (s *seeder) seedInteractions() {
	pcols := []string{"post_id", "user_id", "created_at"}
	var rows [][]any
	for i, pid := range s.postIDs {
		k := s.rng.Intn(12)
		seen := map[int]bool{}
		for n := 0; n < k; n++ {
			u := s.rng.Intn(len(s.userIDs))
			if seen[u] {
				continue
			}
			seen[u] = true
			t := s.postTimes[i].Add(time.Duration(s.rng.Int63n(int64(30 * 24 * time.Hour))))
			rows = append(rows, []any{pid, s.userIDs[u], t})
		}
		if len(rows) >= 50000 {
			s.flush("post_likes", pcols, rows)
			s.counts["post_likes"] += len(rows)
			rows = rows[:0]
		}
	}
	s.flush("post_likes", pcols, rows)
	s.counts["post_likes"] += len(rows)

	target := s.sc.Comments / 50
	if target < 100 {
		target = 100
	}
	ccols := []string{"comment_id", "user_id", "created_at"}
	rows = rows[:0]
	seenPair := map[string]bool{}
	for n := 0; n < target; n++ {
		p := s.rng.Intn(len(s.postIDs))
		cnt := s.postLabels[p]
		if cnt <= 0 {
			continue
		}
		cid := commentID(p, s.rng.Intn(cnt))
		uid := s.userIDs[s.rng.Intn(len(s.userIDs))]
		key := cid + "|" + uid
		if seenPair[key] {
			continue
		}
		seenPair[key] = true
		rows = append(rows, []any{cid, uid, s.now.Add(-time.Duration(s.rng.Int63n(int64(30 * 24 * time.Hour))))})
		if len(rows) >= 50000 {
			s.flush("comment_likes", ccols, rows)
			s.counts["comment_likes"] += len(rows)
			rows = rows[:0]
		}
	}
	s.flush("comment_likes", ccols, rows)
	s.counts["comment_likes"] += len(rows)

	fcols := []string{"post_id", "user_id", "created_at"}
	rows = rows[:0]
	favTarget := s.sc.Posts * 3
	for n := 0; n < favTarget; n++ {
		pid := s.postIDs[s.rng.Intn(len(s.postIDs))]
		uid := s.userIDs[s.rng.Intn(len(s.userIDs))]
		key := pid + "|" + uid
		if seenPair[key] {
			continue
		}
		seenPair[key] = true
		rows = append(rows, []any{pid, uid, s.now.Add(-time.Duration(s.rng.Int63n(int64(60 * 24 * time.Hour))))})
		if len(rows) >= 50000 {
			s.flush("post_favorites", fcols, rows)
			s.counts["post_favorites"] += len(rows)
			rows = rows[:0]
		}
	}
	s.flush("post_favorites", fcols, rows)
	s.counts["post_favorites"] += len(rows)

	// 点赞计数回写（保持列表与详情里的 likes 字段一致）
	s.mustExec(`UPDATE posts p SET likes = l.c FROM (SELECT post_id, count(*) c FROM post_likes GROUP BY post_id) l WHERE p.id = l.post_id`)
	s.mustExec(`UPDATE comments c SET likes = l.c FROM (SELECT comment_id, count(*) c FROM comment_likes GROUP BY comment_id) l WHERE c.id = l.comment_id`)

	// 关注关系
	cols := []string{"follower_id", "following_id", "created_at"}
	rows = rows[:0]
	for i, uid := range s.userIDs {
		k := 5 + s.rng.Intn(20)
		seen := map[int]bool{}
		for n := 0; n < k; n++ {
			j := s.rng.Intn(len(s.userIDs))
			if j == i || seen[j] {
				continue
			}
			seen[j] = true
			rows = append(rows, []any{uid, s.userIDs[j], s.now.Add(-time.Duration(s.rng.Int63n(int64(180 * 24 * time.Hour))))})
		}
		if len(rows) >= 50000 {
			s.flush("user_follows", cols, rows)
			s.counts["user_follows"] += len(rows)
			rows = rows[:0]
		}
	}
	s.flush("user_follows", cols, rows)
	s.counts["user_follows"] += len(rows)
}

// ---- 世界消息 ----

func (s *seeder) seedWorld() {
	cols := []string{"sender_id", "sender_name", "sender_avatar", "content", "content_format", "parent_id",
		"guild_id", "guild_name", "is_leader", "is_admin", "admin_id", "status", "created_at"}
	rows := make([][]any, 0, 10000)
	for i := 0; i < s.sc.World; i++ {
		u := s.rng.Intn(len(s.userIDs))
		rows = append(rows, []any{
			s.userIDs[u], nameOf(u), "", htmlContent(s.rng, 40+s.rng.Intn(200), false), "html", nil,
			"", "", false, false, "", 1, spreadTime(s.rng, s.now.Add(-30*24*time.Hour), s.now),
		})
		if len(rows) >= 10000 {
			s.flush("world_messages", cols, rows)
			rows = rows[:0]
		}
	}
	s.flush("world_messages", cols, rows)
	s.counts["world_messages"] = s.sc.World
}

// ---- 私信 ----

func (s *seeder) seedChat() {
	rooms := len(s.userIDs)
	if rooms > 200 {
		rooms = 200
	}
	roomUser := make([]string, rooms+1)
	rcols := []string{"id", "user_id", "created_at"}
	var rows [][]any
	for i := 1; i <= rooms; i++ {
		uid := s.userIDs[i-1]
		roomUser[i] = uid
		rows = append(rows, []any{i, uid, s.now.AddDate(0, 0, -60)})
	}
	s.flush("chat_rooms", rcols, rows)
	s.mustExec(fmt.Sprintf("SELECT setval('chat_rooms_id_seq', %d, true)", rooms))
	s.counts["chat_rooms"] = rooms

	mcols := []string{"room_id", "member_type", "member_id", "last_read_message_id", "created_at", "updated_at"}
	rows = rows[:0]
	for i := 1; i <= rooms; i++ {
		rows = append(rows, []any{i, "user", roomUser[i], 0, s.now.AddDate(0, 0, -60), s.now})
	}
	s.flush("chat_members", mcols, rows)
	s.counts["chat_members"] = rooms

	msgCols := []string{"room_id", "sender_type", "admin_id", "forum_account_id", "forum_account_name",
		"forum_account_avatar", "content_html", "content_format", "created_at"}
	rows = rows[:0]
	for i := 0; i < s.sc.Chat; i++ {
		r := 1 + s.rng.Intn(rooms)
		u := roomUser[r]
		rows = append(rows, []any{
			r, "user", "", u, nameOf(r - 1), "",
			htmlContent(s.rng, 40+s.rng.Intn(300), false), "html",
			spreadTime(s.rng, s.now.Add(-60*24*time.Hour), s.now),
		})
		if len(rows) >= 10000 {
			s.flush("chat_messages", msgCols, rows)
			rows = rows[:0]
		}
	}
	s.flush("chat_messages", msgCols, rows)
	s.counts["chat_messages"] = s.sc.Chat
}

// ---- 通知 ----

func (s *seeder) seedNotifications() {
	types := []string{"comment", "like", "follow", "system"}
	cols := []string{"user_id", "type", "actor_id", "target_type", "target_id", "context_post_id",
		"context_comment_id", "payload", "dedupe_key", "is_read", "read_at", "created_at"}
	rows := make([][]any, 0, 10000)
	for i := 0; i < s.sc.Notifications; i++ {
		u := s.userIDs[s.rng.Intn(len(s.userIDs))]
		actor := s.userIDs[s.rng.Intn(len(s.userIDs))]
		pid := s.postIDs[s.rng.Intn(len(s.postIDs))]
		read := s.rng.Intn(3) == 0
		var readAt any
		created := s.now.Add(-time.Duration(s.rng.Int63n(int64(60 * 24 * time.Hour))))
		if read {
			readAt = created.Add(time.Hour)
		}
		rows = append(rows, []any{
			u, types[i%len(types)], actor, "post", pid, pid, "",
			mustJSON(map[string]string{"text": plainText(s.rng, 6)}), "", read, readAt, created,
		})
		if len(rows) >= 10000 {
			s.flush("notifications", cols, rows)
			rows = rows[:0]
		}
	}
	s.flush("notifications", cols, rows)
	s.counts["notifications"] = s.sc.Notifications
}

// ---- 媒体 ----

func (s *seeder) seedMedia() {
	data, err := base64.StdEncoding.DecodeString(tinyJPEGBase64)
	if err != nil {
		logFatalf("内置图片解码失败：%v", err)
	}
	n := s.tier(100, 1000, 5000)
	cols := []string{"id", "file_name", "original_name", "mime", "size", "uploader_user_id", "scene",
		"status", "deleted_by_admin_id", "created_at", "storage_provider", "bucket", "object_key",
		"public_url", "owner_type", "owner_id", "guild_uuid", "width", "height", "sha256",
		"visibility", "is_legacy", "gc_state", "uploader_admin_id"}
	rows := make([][]any, 0, n)
	for i := 0; i < n; i++ {
		fn := fmt.Sprintf("bench_%06d.jpg", i)
		if err := os.WriteFile(filepath.Join(s.mediaDir, fn), data, 0o644); err != nil {
			logFatalf("写入媒体文件失败：%v", err)
		}
		id := fmt.Sprintf("BM%06d", i)
		pid := s.postIDs[i%len(s.postIDs)]
		rows = append(rows, []any{
			id, fn, fn, "image/jpeg", len(data), s.userIDs[i%len(s.userIDs)], "post_image",
			int16(1), "", s.now.Add(-time.Duration(s.rng.Int63n(int64(30 * 24 * time.Hour)))),
			"local", "", "", "", "post", pid, "", 1, 1, "",
			"public", false, int16(0), "",
		})
		s.mediaIDs = append(s.mediaIDs, id)
	}
	s.flush("media_assets", cols, rows)
	s.counts["media_assets"] = n
}

// ---- 指南 ----

func (s *seeder) seedGuides() {
	n := s.tier(20, 50, 100)
	cols := []string{"id", "parent_id", "title", "kind", "sort", "content", "content_format", "created_at", "updated_at"}
	var rows [][]any
	for i := 0; i < 10 && i < n; i++ {
		rows = append(rows, []any{guideID(i), nil, fmt.Sprintf("指南目录%d", i), "folder", i, "", "html", s.now.AddDate(0, 0, -90), s.now})
		s.guideIDs = append(s.guideIDs, guideID(i))
	}
	s.flush("guide_nodes", cols, rows)
	rows = rows[:0]
	for i := 10; i < n; i++ {
		rows = append(rows, []any{
			guideID(i), guideID(i % 10), fmt.Sprintf("指南文章%d", i), "doc", i,
			htmlContent(s.rng, 1000+s.rng.Intn(4000), false), "html",
			s.now.AddDate(0, 0, -60), s.now,
		})
		s.guideIDs = append(s.guideIDs, guideID(i))
	}
	s.flush("guide_nodes", cols, rows)
	s.counts["guide_nodes"] = n
}

// ---- 反馈 / 更新日志 ----

func (s *seeder) seedMisc() {
	n := s.tier(50, 200, 1000)
	cols := []string{"title", "detail", "steps", "contact", "reporter_id", "reporter_name",
		"user_agent", "page_url", "status", "created_at"}
	rows := make([][]any, 0, n)
	for i := 0; i < n; i++ {
		u := s.rng.Intn(len(s.userIDs))
		rows = append(rows, []any{
			fmt.Sprintf("反馈问题%d", i), plainText(s.rng, 15), plainText(s.rng, 5), "",
			s.userIDs[u], nameOf(u), "bench-agent", "/bench", s.rng.Intn(4),
			s.now.Add(-time.Duration(s.rng.Int63n(int64(90 * 24 * time.Hour)))),
		})
	}
	s.flush("bug_reports", cols, rows)
	s.counts["bug_reports"] = n

	cn := s.tier(20, 50, 100)
	ccols := []string{"version", "title", "content_html", "published_at", "is_published", "created_by", "created_at", "updated_at"}
	rows = rows[:0]
	for i := 0; i < cn; i++ {
		t := s.now.AddDate(0, 0, -i*7)
		rows = append(rows, []any{
			fmt.Sprintf("2.%d.%d", i/10, i%10), fmt.Sprintf("基准更新%d", i),
			htmlContent(s.rng, 300, false), t, true, "bench", t, t,
		})
	}
	s.flush("changelogs", ccols, rows)
	s.counts["changelogs"] = cn
}

// ---- 角色设定卡 ----

func (s *seeder) seedCharacterSheets() {
	n := len(s.userIDs) / 10
	if n < 1 {
		n = 1
	}
	if n > 200 {
		n = 200
	}
	scols := []string{"id", "user_id", "status", "version", "name", "alias", "title", "gender", "age",
		"build", "species", "identity", "description_html", "avatar_media_id", "guild_id",
		"guild_custom_name", "quotes_visible", "like_count", "published_at", "created_at", "updated_at"}
	var rows [][]any
	sheetIDs := make([]string, 0, n)
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("BS%06d", i)
		uid := s.userIDs[i]
		created := s.now.AddDate(0, 0, -30)
		gid := i%s.sc.Guilds + 1
		var avatar any
		if len(s.mediaIDs) > 0 {
			avatar = s.mediaIDs[i%len(s.mediaIDs)]
		}
		rows = append(rows, []any{
			id, uid, int16(1), 1, fmt.Sprintf("角色%d", i), "别名", "称号", int16(0), "18",
			"中等", "妖精", "旅行者", htmlContent(s.rng, 600, false), avatar, gid,
			"", true, 0, created, created, created,
		})
		sheetIDs = append(sheetIDs, id)
	}
	s.flush("character_sheets", scols, rows)

	acols := []string{"sheet_id", "sort_order", "category", "detail"}
	var arows [][]any
	for _, sid := range sheetIDs {
		for j := 0; j < 3; j++ {
			arows = append(arows, []any{sid, j, "ability", plainText(s.rng, 3)})
		}
	}
	s.flush("character_sheet_abilities", acols, arows)

	qcols := []string{"sheet_id", "content", "sort_order", "is_active", "created_at"}
	var qrows [][]any
	for _, sid := range sheetIDs {
		for j := 0; j < 2; j++ {
			qrows = append(qrows, []any{sid, plainText(s.rng, 6), j, true, s.now})
		}
	}
	s.flush("character_sheet_quotes", qcols, qrows)

	if len(s.mediaIDs) > 0 {
		imgCols := []string{"sheet_id", "media_id", "sort_order"}
		var irows [][]any
		for i, sid := range sheetIDs {
			irows = append(irows, []any{sid, s.mediaIDs[i%len(s.mediaIDs)], 0})
		}
		s.flush("character_sheet_images", imgCols, irows)
	}

	lcols := []string{"sheet_id", "user_id", "created_at"}
	var lrows [][]any
	for _, sid := range sheetIDs {
		seen := map[string]bool{}
		for k := 0; k < 5; k++ {
			uid := s.userIDs[s.rng.Intn(len(s.userIDs))]
			if seen[uid] {
				continue
			}
			seen[uid] = true
			lrows = append(lrows, []any{sid, uid, s.now.Add(-time.Duration(s.rng.Int63n(int64(30 * 24 * time.Hour))))})
		}
	}
	s.flush("character_sheet_likes", lcols, lrows)
	s.mustExec(`UPDATE character_sheets c SET like_count = l.c FROM (SELECT sheet_id, count(*) c FROM character_sheet_likes GROUP BY sheet_id) l WHERE c.id = l.sheet_id`)
	s.counts["character_sheets"] = len(sheetIDs)
}

// ---- 收尾与 ID 池 ----

func (s *seeder) finalize() {
	s.mustExec(`VACUUM (ANALYZE) users, guilds, guild_members, guild_articles, posts, comments, post_likes, comment_likes, post_favorites, user_follows, world_messages, chat_messages, notifications, media_assets, guide_nodes, bug_reports, changelogs, character_sheets`)
	// 清空 SQL 统计，保证后续跑分只反映基准流量
	s.mustExec(`SELECT pg_stat_statements_reset()`)
}

func (s *seeder) buildIDs() *IDSet {
	hot := make([]int, len(s.postLabels))
	for i := range hot {
		hot[i] = i
	}
	sort.Slice(hot, func(a, b int) bool { return s.postLabels[hot[a]] > s.postLabels[hot[b]] })
	if len(hot) > 50 {
		hot = hot[:50]
	}
	hotIDs := make([]string, 0, len(hot))
	for _, i := range hot {
		hotIDs = append(hotIDs, s.postIDs[i])
	}

	return &IDSet{
		Tokens:      s.tokens,
		UserIDs:     sampleStrings(s.userIDs, 2000),
		PostIDs:     sampleStrings(s.postIDs, 2000),
		HotPostIDs:  hotIDs,
		CommentIDs:  sampleStrings(s.commentIDs, 2000),
		GuildSlugs:  s.guildSlugs,
		ArticleIDs:  sampleStrings(s.articleIDs, 2000),
		GuideIDs:    sampleStrings(s.guideIDs, 500),
		MediaIDs:    sampleStrings(s.mediaIDs, 2000),
		SearchTerms: []string{"星海", "灵质空间", "会馆", "罗小黑", "不存在的关键词"},
	}
}

func sampleStrings(in []string, max int) []string {
	if len(in) <= max {
		out := make([]string, len(in))
		copy(out, in)
		return out
	}
	step := float64(len(in)) / float64(max)
	out := make([]string, 0, max)
	for i := 0; i < max; i++ {
		out = append(out, in[int(float64(i)*step)])
	}
	return out
}
