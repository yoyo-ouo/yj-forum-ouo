package handler

// 帖子草稿接口：列表 / 新建 / 读取 / 自动保存 / 发布 / 放弃。
// 所有端点都要求登录，且数据库查询带 user_id 条件；非本人一律按「不存在」处理，避免泄漏草稿存在性。

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/database"
)

const maxPostDraftTitleRunes = 100

type postDraftReq struct {
	Title       string `json:"title"`
	Content     string `json:"content"`
	Category    string `json:"category"`
	GuildUUID   string `json:"guild_uuid"`
	ScheduledAt string `json:"scheduled_at"`
}

// normalizeDraftTitle 草稿标题（允许空；非空时去首尾空白且不超过 100 字符）。
func normalizeDraftTitle(raw string) (string, string) {
	title := strings.TrimSpace(raw)
	if utf8.RuneCountInString(title) > maxPostDraftTitleRunes {
		return "", "标题不能超过100字符"
	}
	return title, ""
}

// draftFail 草稿错误的统一响应（非本人 / 不存在统一 404）。
func draftFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, database.ErrPostDraftNotFound):
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "草稿不存在或已被删除"})
	case errors.Is(err, database.ErrPostDraftLimit):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "草稿数量已达上限（50），请先删除部分草稿"})
	default:
		log.Printf("[POST_DRAFT] 操作失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "操作失败"})
	}
}

// ---- GET /ov2/api/posts/drafts ----

// ListDrafts 我的草稿（仅本人；limit 默认 20，最大 50）。
func (h *PostsHandler) ListDrafts(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	drafts, err := h.DB.ListPostDrafts(c.Request.Context(), uid, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "drafts": drafts})
}

// ---- POST /ov2/api/posts/drafts ----

// CreateDraft 新建空草稿（前端在有实际内容时调用）。
func (h *PostsHandler) CreateDraft(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	id, err := h.DB.CreatePostDraft(c.Request.Context(), uid)
	if err != nil {
		draftFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "id": id})
}

// ---- GET /ov2/api/posts/drafts/:id ----

// GetDraft 读取草稿详情（仅作者本人）。
func (h *PostsHandler) GetDraft(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	draft, err := h.DB.GetPostDraft(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		draftFail(c, err)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "draft": draft})
}

// ---- PUT /ov2/api/posts/drafts/:id ----

// SaveDraft 自动保存（3 秒防抖由前端控制；服务端允许空标题/空正文）。
func (h *PostsHandler) SaveDraft(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	var req postDraftReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
		return
	}
	title, msg := normalizeDraftTitle(req.Title)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	content, msg := cleanPostContent(req.Content, false)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	scheduledAt, msg := parsePostSchedule(req.ScheduledAt, false)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	category, guildID, status, msg := h.resolvePostTarget(c.Request.Context(), uid, req.Category, req.GuildUUID, nil)
	if status != 0 {
		c.JSON(status, gin.H{"success": false, "message": msg})
		return
	}
	savedAt, err := h.DB.SavePostDraft(c.Request.Context(), c.Param("id"), uid, database.PostDraftInput{
		Title:       title,
		Content:     content,
		Category:    category,
		GuildID:     guildID,
		ScheduledAt: scheduledAt,
	})
	if err != nil {
		draftFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "saved_at": savedAt})
}

// ---- POST /ov2/api/posts/drafts/:id/publish ----

// PublishDraft 发布草稿（事务内写 posts、转挂媒体、删草稿）。
func (h *PostsHandler) PublishDraft(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	var req postDraftReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
		return
	}
	title, msg := normalizePostTitle(req.Title)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	content, msg := cleanPostContent(req.Content, true)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	publishedAt, msg := parsePostSchedule(req.ScheduledAt, true)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	category, guildID, status, msg := h.resolvePostTarget(c.Request.Context(), uid, req.Category, req.GuildUUID, nil)
	if status != 0 {
		c.JSON(status, gin.H{"success": false, "message": msg})
		return
	}
	postID, err := h.DB.PublishPostDraft(c.Request.Context(), c.Param("id"), uid, database.PostDraftPublishInput{
		Title:       title,
		Content:     content,
		Category:    category,
		GuildID:     guildID,
		PublishedAt: publishedAt,
	})
	if err != nil {
		draftFail(c, err)
		return
	}
	if publishedAt == nil {
		// 立即帖：灵力奖励同步完成（source 幂等）；定时帖由补偿任务到点补发。
		h.awardPostSpirit(c.Request.Context(), uid, postID)
	}
	h.Cache.Posts.DeletePrefix("posts:list:")
	h.Cache.Posts.Delete(randomPoolKey)
	h.invalidateFeedCaches()
	h.Cache.Search.DeletePrefix("search:")
	c.JSON(http.StatusCreated, gin.H{"success": true, "id": postID})
}

// ---- DELETE /ov2/api/posts/drafts/:id ----

// DeleteDraft 放弃草稿，并清理仅被该草稿引用的媒体。
func (h *PostsHandler) DeleteDraft(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	if err := h.DB.DeletePostDraft(c.Request.Context(), c.Param("id"), uid); err != nil {
		draftFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
