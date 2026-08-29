package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ---- GET /api/v1/world/messages ----

// WorldMessages 世界消息（缓存 2s）。
func (h *PostsHandler) WorldMessages(c *gin.Context) {
	if v, ok := h.Cache.World.Get("world:messages"); ok {
		c.Header("X-Cache", "HIT")
		c.JSON(http.StatusOK, v)
		return
	}
	msgs, err := h.DB.GetWorldMessages(c.Request.Context(), 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
		return
	}
	h.Cache.World.Set("world:messages", msgs, 2*time.Second)
	c.Header("X-Cache", "MISS")
	c.JSON(http.StatusOK, msgs)
}

// ---- POST /api/v1/world/messages ----

type worldSendReq struct {
	Content  string `json:"content" binding:"required"`
	ParentID *int64 `json:"parent_id"`
}

// WorldSend 发送世界消息。
func (h *PostsHandler) WorldSend(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	var req worldSendReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" || len([]rune(content)) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "内容需1-500字符"})
		return
	}
	// 2 秒间隔限速
	last, _ := h.DB.GetWorldLastSentAt(c.Request.Context(), uid)
	if last != nil && time.Since(*last) < 2*time.Second {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "发送太频繁"})
		return
	}
	u, err := h.DB.GetUserByID(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "用户不存在"})
		return
	}
	if err := h.DB.SendWorldMessage(c.Request.Context(), uid, u.Name, content, req.ParentID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "发送失败"})
		return
	}
	h.Cache.World.Delete("world:messages")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
