package handler

import (
	"context"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/altcha"
	"yj-forum/server/internal/auth"
	"yj-forum/server/internal/config"
	"yj-forum/server/internal/database"
	"yj-forum/server/internal/email"
	"yj-forum/server/internal/media"
	"yj-forum/server/internal/models"
	"yj-forum/server/internal/sanitize"
)

// maxPostContentBytes 发帖原始正文长度上限（256KB，与管理端发帖限制保持一致）。
const maxPostContentBytes = 256 * 1024

// PostsHandler 帖子/评论/收藏相关（含缓存）。
type PostsHandler struct {
	DB       *database.DB
	Cfg      *config.Config
	Cache    *CacheSet
	Mailer   *email.Sender
	Sessions *auth.SessionManager
	Media    *media.Service
	Altcha   *altcha.Service // nil 安全：未注入时跳过 ALTCHA 校验
}

// ---- GET /ov2/api/posts ----

// List 帖子列表（缓存 posts:list:page:size:cat）。
func (h *PostsHandler) List(c *gin.Context) {
	page, pageSize := parsePage(c)
	if pageSize > 50 {
		pageSize = 50
	}
	category := c.Query("category")
	key := "posts:list:" + itoa(page) + ":" + itoa(pageSize) + ":" + category
	if v, ok := h.Cache.Posts.Get(key); ok {
		c.Header("X-Cache", "HIT")
		c.JSON(http.StatusOK, v)
		return
	}
	posts, err := h.DB.GetPostList(c.Request.Context(), page, pageSize, category)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
		return
	}
	resp := gin.H{"success": true, "posts": posts, "page": page, "page_size": pageSize}
	h.Cache.Posts.Set(key, resp, 30*time.Second)
	c.Header("X-Cache", "MISS")
	c.JSON(http.StatusOK, resp)
}

// ---- GET /ov2/api/posts/random ----

// randomPoolKey 随机推荐候选池（缓存 60s，避免每次请求都全表 ORDER BY RANDOM）。
const randomPoolKey = "posts:random:pool"

// randomPoolSize 候选池大小；每次响应从中随机取 100 条（首页「继续加载」重复调用）。
const randomPoolSize = 200

// Random 随机推荐（每次 100 条）。
// 候选池按 60s 缓存：池内随机打乱后取前 100；既保持「每次都是随机顺序」，又把全表排序压到分钟级一次。
func (h *PostsHandler) Random(c *gin.Context) {
	var (
		pool  []models.PostListItem
		found bool
	)
	if v, ok := h.Cache.Posts.Get(randomPoolKey); ok {
		if cached, ok := v.([]models.PostListItem); ok {
			pool, found = cached, true
		}
	}
	if !found {
		posts, err := h.DB.GetRandomPosts(c.Request.Context(), randomPoolSize)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
			return
		}
		pool = posts
		// 池为空也缓存，避免空库/全定时未发布时反复打 DB
		h.Cache.Posts.Set(randomPoolKey, pool, 60*time.Second)
	}
	// 复制后打乱，避免并发请求互相修改共享切片顺序
	out := make([]models.PostListItem, len(pool))
	copy(out, pool)
	rand.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	if len(out) > 100 {
		out = out[:100]
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "posts": out})
}

// ---- GET /ov2/api/posts/picker-defaults ----

// PickerDefaults 引用选择器默认项（登录用户；关注/收藏各至多 20 条，依赖 viewer 不做共享缓存）。
func (h *PostsHandler) PickerDefaults(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	following, favorites, err := h.DB.GetPickerDefaultPosts(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"following_posts": following, "favorite_posts": favorites,
	}})
}

// ---- POST /ov2/api/posts ----

type createPostReq struct {
	Title    string `json:"title" binding:"required"`
	Content  string `json:"content" binding:"required"`
	Category string `json:"category"`
	GuildID  *int64 `json:"guild_id"`
	// GuildUUID 会馆稳定标识（优先于 guild_id）
	GuildUUID string `json:"guild_uuid"`
	// PublishedAt 定时发布时间（RFC3339 字符串，可选；未来时间即定时未发布）
	PublishedAt string `json:"published_at"`
}

// normalizePostTitle 标题归一化：去首尾空白，要求 1-100 字符。
func normalizePostTitle(raw string) (string, string) {
	title := strings.TrimSpace(raw)
	if title == "" || utf8.RuneCountInString(title) > 100 {
		return "", "标题需1-100字符"
	}
	return title, ""
}

// cleanPostContent 正文净化与校验。
// strict=true（正式发布）额外校验节点上限与非空；strict=false（草稿自动保存）只限制原始长度，
// 允许空内容——草稿允许用户写到一半，硬性要求会打断自动保存。
func cleanPostContent(raw string, strict bool) (string, string) {
	if len(raw) > maxPostContentBytes {
		return "", "正文过长"
	}
	clean := sanitize.SanitizeRichContent(raw)
	if !strict {
		return clean, ""
	}
	// 节点上限（净化后计数）：防超大 DOM 结构拖垮渲染与存储。
	if strings.Count(clean, "<img") > 60 || strings.Count(clean, "data-embed=") > 30 {
		return "", "图片/引用数量过多"
	}
	hasRichMedia := strings.Contains(clean, "<img") || strings.Contains(clean, "data-embed")
	if sanitize.StripTagsAndTrim(clean) == "" && !hasRichMedia {
		return "", "正文不能为空"
	}
	return clean, ""
}

// parsePostSchedule 解析定时发布时间（RFC3339，转 UTC 存储）。
// strict=true（正式发布）要求晚于当前时间 1 分钟且不超过 365 天；
// strict=false（草稿）只校验格式——草稿可能被放置很久，存下过期时间由前端重新选择。
func parsePostSchedule(raw string, strict bool) (*time.Time, string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, ""
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, "定时发布时间格式错误，需 RFC3339"
	}
	if strict {
		now := time.Now()
		if !t.After(now.Add(time.Minute)) {
			return nil, "定时发布时间需晚于当前时间 1 分钟"
		}
		if t.After(now.Add(365 * 24 * time.Hour)) {
			return nil, "定时发布时间不能超过 365 天"
		}
	}
	// 时间列与比较基准均为库内 NOW()/CURRENT_TIMESTAMP（UTC），统一转 UTC 存储。
	utc := t.UTC()
	return &utc, ""
}

// resolvePostTarget 解析发布目标（公共空间 / 会馆），返回归一化分类、guildID。
// 非 0 的 httpStatus 表示失败，message 可直接回给客户端。
func (h *PostsHandler) resolvePostTarget(ctx context.Context, uid, category, guildUUID string, guildIDIn *int64) (string, *int64, int, string) {
	var guildID *int64
	if gu := strings.TrimSpace(guildUUID); gu != "" {
		// guild_uuid 优先：按稳定标识反查数字 id
		id, err := h.DB.GetGuildIDByUUID(ctx, gu)
		if err != nil {
			return "", nil, http.StatusInternalServerError, "查询失败"
		}
		if id == nil {
			return "", nil, http.StatusNotFound, "会馆不存在"
		}
		guildID = id
	} else if guildIDIn != nil && *guildIDIn > 0 {
		guildID = guildIDIn
	}
	if guildID != nil {
		// 会馆帖：仅成员可发，分类自会馆配置取值
		if !h.DB.IsGuildMember(ctx, *guildID, uid) {
			return "", nil, http.StatusForbidden, "你还不是该会馆成员，无法发帖"
		}
		return h.DB.ResolveGuildCategory(ctx, *guildID, strings.TrimSpace(category)), guildID, 0, ""
	}
	return normalizeCategory(category), nil, 0, ""
}

// Create 发帖（可选 guild_uuid/guild_id：需为会馆成员，分类取自该馆配置）。
func (h *PostsHandler) Create(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	var req createPostReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	title, msg := normalizePostTitle(req.Title)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	// 正文服务端校验：原始长度上限 + 净化后非空（纯图片/纯引用帖视为有效内容）
	sanitizedContent, msg := cleanPostContent(req.Content, true)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	// 定时发布（可选）：RFC3339 解析；必须晚于当前时间 1 分钟且不超过 365 天
	publishedAt, msg := parsePostSchedule(req.PublishedAt, true)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	cat, guildID, status, msg := h.resolvePostTarget(c.Request.Context(), uid, req.Category, req.GuildUUID, req.GuildID)
	if status != 0 {
		c.JSON(status, gin.H{"success": false, "message": msg})
		return
	}
	postID, err := h.DB.SendPost(c.Request.Context(), uid, title, sanitizedContent, cat, guildID, publishedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "发布失败"})
		return
	}
	if publishedAt == nil {
		// 立即帖：灵力奖励同步完成（source 幂等）。
		// 粉丝发帖邮件提醒已按需求下线；定时帖由 ProcessScheduledPublishes 到点补发灵力。
		h.awardPostSpirit(c.Request.Context(), uid, postID)
	}
	h.Cache.Posts.DeletePrefix("posts:list:")
	h.Cache.Posts.Delete(randomPoolKey)
	h.invalidateFeedCaches()
	c.JSON(http.StatusCreated, gin.H{"success": true, "id": postID})
}

// awardPostSpirit 发帖灵力奖励（post +5，按 source=postID 幂等；达到日上限时静默跳过）。
func (h *PostsHandler) awardPostSpirit(ctx context.Context, userID, postID string) {
	awarded, amount, err := h.DB.AwardSpirit(ctx, userID, "post", postID)
	if err != nil {
		log.Printf("[SPIRIT] 发帖奖励失败 post=%s: %v", postID, err)
		return
	}
	if awarded {
		log.Printf("[SPIRIT] 发帖奖励 +%d (user=%s post=%s)", amount, userID, postID)
	}
}

// postVisible 帖子可见性校验：不存在、已软删（status != 1）、或定时未发布且 viewer 非作者时写入 404 并返回 false。
// 供点赞/收藏/举报/评论等路径复用（GetPostPublishInfo 仅取发布状态，不含帖子正文）；
// 软删帖与 Detail 行为一致，一律视为不可见，不能再评论/点赞/收藏/举报/读评论列表。
func (h *PostsHandler) postVisible(c *gin.Context, postID, viewer string) bool {
	authorID, publishedAt, status, exists, err := h.DB.GetPostPublishInfo(c.Request.Context(), postID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
		return false
	}
	if !exists || status != 1 || (publishedAt.After(time.Now()) && viewer != authorID) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "帖子不存在"})
		return false
	}
	return true
}

// ProcessScheduledPublishes 定时补发任务：把到点的定时帖原子标记为已通知（每次至多 50 条），
// 补发灵力奖励；有新帖转公开时失效帖子列表/搜索/详情缓存。由 main 每分钟 ticker 调用。
func (h *PostsHandler) ProcessScheduledPublishes(ctx context.Context) {
	pending, err := h.DB.ClaimPendingPublishPosts(ctx)
	if err != nil {
		log.Printf("[POST] 定时发布认领失败: %v", err)
		return
	}
	if len(pending) == 0 {
		return
	}
	for _, p := range pending {
		// 到点补发灵力奖励（与立即帖一致，source 幂等避免重复）
		h.awardPostSpirit(ctx, p.UserID, p.ID)
	}
	// 定时帖转为可见：失效帖子列表、信息流、搜索与单帖详情缓存
	h.Cache.Posts.DeletePrefix("posts:list:")
	h.Cache.Posts.Delete(randomPoolKey)
	h.invalidateFeedCaches()
	h.Cache.Search.DeletePrefix("search:")
	for _, p := range pending {
		h.invalidatePostDetail(p.ID)
	}
	log.Printf("[POST] 定时发布完成 %d 篇", len(pending))
}

// invalidatePostDetail 失效帖子详情缓存（含 include_comments=0 的「仅正文」变体）。
func (h *PostsHandler) invalidatePostDetail(postID string) {
	h.Cache.PostDetail.Delete("post:detail:" + postID)
	h.Cache.PostDetail.Delete("post:detail:" + postID + ":postonly")
}

// invalidateFeedCaches 失效会馆/全站信息流缓存（`feed:` 前缀）。
// 信息流本身 TTL 30s，这里保证发帖/删帖/点赞后立刻能看到变化。
func (h *PostsHandler) invalidateFeedCaches() {
	h.Cache.Posts.DeletePrefix("feed:")
}

// ---- GET /ov2/api/posts/:id ----

// Detail 帖子详情（匿名缓存 post:detail:ID；登录用户实时返回含个人状态）。
// track=0：SEO 等服务端拉取不计数、只读匿名缓存不写入；其余请求同一访客同帖 30 分钟内只计一次（匿名按 IP / 登录按 uid）。
func (h *PostsHandler) Detail(c *gin.Context) {
	id := c.Param("id")
	me := currentUserFromCookie(c, h.Sessions)
	noTrack := c.Query("track") == "0"
	// include_comments=0：只回帖子本体。SEO/首屏正文不需要评论时跳过 50 条评论查询，
	// 前端改为并行拉 /posts/:id/comments，正文不再被评论拖住。默认 1 保持旧契约。
	includeComments := c.Query("include_comments") != "0"
	key := "post:detail:" + id
	if !includeComments {
		key += ":postonly"
	}
	// SEO（track=0）复用匿名详情缓存读：不计数、只读不写，避免每次 SEO 拉取都打到 DB 导致超时
	if me == "" {
		if v, ok := h.Cache.PostDetail.Get(key); ok {
			c.Header("X-Cache", "HIT")
			c.JSON(http.StatusOK, v)
			return
		}
	}
	post, err := h.DB.GetPost(c.Request.Context(), id)
	if err != nil || post == nil || post.Status != 1 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "帖子不存在"})
		return
	}
	// 定时帖未到发布时间：仅作者本人可见，其余视角一律 404
	if post.PublishedAt != nil && post.PublishedAt.After(time.Now()) && me != post.UserID {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "帖子不存在"})
		return
	}
	if !noTrack {
		// 同一访客同帖 30 分钟内只计一次（匿名按 IP / 登录按 uid；进程内近似去重，容忍 NAT 与多实例误差）
		voterKey := "ip:" + c.ClientIP()
		if me != "" {
			voterKey = "u:" + me
		}
		dedupKey := "post:view:" + id + ":" + voterKey
		// 原子占位：并发/重复请求只有一个能占位成功并计数；计数失败则回滚占位，允许下次重试
		if h.Cache.ViewDedup.SetIfAbsent(dedupKey, true) {
			if err := h.DB.IncrementPostViews(c.Request.Context(), id); err == nil {
				post.Views++
			} else {
				h.Cache.ViewDedup.Delete(dedupKey)
			}
		}
	}

	liked, favorited := false, false
	if me != "" {
		liked = h.DB.HasLikedPost(c.Request.Context(), id, me)
		favorited = h.DB.HasFavoritedPost(c.Request.Context(), id, me)
	}
	// 评论（附带，取最新 50 条；无更早翻页）；include_comments=0 时跳过，字段保留空数组以免契约变化
	comments := []models.Comment{}
	if includeComments {
		comments, _, _ = h.DB.GetPostComments(c.Request.Context(), id, 50, nil)
		if me != "" {
			markCommentLikedByMe(h.DB, c.Request.Context(), me, comments)
		}
	}
	resp := gin.H{"success": true, "post": post, "comments": comments, "liked": liked, "favorited": favorited}
	if noTrack {
		// track=0 的服务端拉取不写共享缓存，避免覆盖/污染读者视角的数据
		c.Header("X-Cache", "BYPASS")
	} else if me == "" {
		h.Cache.PostDetail.Set(key, resp, 60*time.Second)
		c.Header("X-Cache", "MISS")
	} else {
		// 含个人点赞/收藏状态，不走共享缓存
		c.Header("X-Cache", "BYPASS")
	}
	c.JSON(http.StatusOK, resp)
}

// ---- POST /ov2/api/posts/:id/like ----

// Like 点赞切换。
func (h *PostsHandler) Like(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	id := c.Param("id")
	if !h.postVisible(c, id, uid) {
		return
	}
	liked, likes, err := h.DB.LikePost(c.Request.Context(), id, uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "操作失败"})
		return
	}
	if liked {
		h.notifyPostLike(c.Request.Context(), id, uid)
	}
	h.invalidatePostDetail(id)
	h.Cache.Posts.DeletePrefix("posts:list:")
	h.Cache.Posts.Delete(randomPoolKey)
	h.invalidateFeedCaches()
	c.JSON(http.StatusOK, gin.H{"success": true, "liked": liked, "likes": likes})
}

// notifyPostLike 点赞帖子后给作者写站内通知（跳过自赞；dedupe 防重复）。
func (h *PostsHandler) notifyPostLike(ctx context.Context, postID, actorID string) {
	authorID, _, _, exists, err := h.DB.GetPostPublishInfo(ctx, postID)
	if err != nil || !exists || authorID == "" || authorID == actorID {
		return
	}
	title := ""
	if post, perr := h.DB.GetPost(ctx, postID); perr == nil && post != nil {
		title = post.Title
	}
	actorName, actorAvatar := actorID, ""
	if u, uerr := h.DB.GetUserByID(ctx, actorID); uerr == nil && u != nil {
		actorName, actorAvatar = u.Name, u.Avatar
	}
	in := database.NotificationInput{
		UserID: authorID, Type: database.NotificationPostLike, ActorID: actorID,
		TargetType: "post", TargetID: postID, ContextPostID: postID,
		Payload:   map[string]any{"post_id": postID, "post_title": title, "actor_name": actorName},
		DedupeKey: "post_like:" + postID + ":" + actorID,
	}
	notifID, created, nerr := h.DB.CreateNotification(ctx, in)
	if nerr != nil || !created {
		return
	}
	PushNotificationEvent(authorID, notifID, gin.H{
		"id": notifID, "type": in.Type, "actor_id": actorID, "actor_name": actorName, "actor_avatar": actorAvatar,
		"target_type": "post", "target_id": postID, "post_id": postID, "post_title": title,
	})
	PushUnreadEvent(ctx, h.DB, authorID)
}

// ---- POST /ov2/api/posts/:id/favorite ----

// Favorite 收藏切换。
func (h *PostsHandler) Favorite(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	id := c.Param("id")
	if !h.postVisible(c, id, uid) {
		return
	}
	favorited, err := h.DB.ToggleFavorite(c.Request.Context(), id, uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "操作失败"})
		return
	}
	h.invalidatePostDetail(id)
	c.JSON(http.StatusOK, gin.H{"success": true, "favorited": favorited})
}

// ---- POST /ov2/api/posts/:id/delete ----

// Delete 删除帖子（仅作者）。
func (h *PostsHandler) Delete(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	id := c.Param("id")
	ok, err := h.DB.DeletePost(c.Request.Context(), id, uid)
	if err != nil || !ok {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权限删除该帖子"})
		return
	}
	h.invalidatePostDetail(id)
	h.Cache.Posts.DeletePrefix("posts:list:")
	h.Cache.Posts.Delete(randomPoolKey)
	h.invalidateFeedCaches()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ---- POST /ov2/api/posts/:id/report ----

type reportPostReq struct {
	Reason string `json:"reason" binding:"required"`
	Detail string `json:"detail"`
}

// Report 举报帖子。
func (h *PostsHandler) Report(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	id := c.Param("id")
	if !h.postVisible(c, id, uid) {
		return
	}
	var req reportPostReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if len([]rune(req.Detail)) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "详情不能超过500字"})
		return
	}
	if err := h.DB.ReportPost(c.Request.Context(), id, uid, req.Reason, req.Detail); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "举报失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AuthRequired 会话校验。
func (h *PostsHandler) AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, _ := c.Cookie(cookieName)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
			return
		}
		userID, err := h.Sessions.Validate(c.Request.Context(), token)
		if err != nil || userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "登录已过期，请重新登录"})
			return
		}
		c.Set("userID", userID)
		c.Next()
	}
}
