package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/database"
	"yj-forum/server/internal/email"
	"yj-forum/server/internal/models"
)

// ---- GET /api/v1/posts/:id/comments ----

// Comments 评论列表（匿名缓存 comments:post:ID；登录用户实时返回含 liked_by_me）。
func (h *PostsHandler) Comments(c *gin.Context) {
	id := c.Param("id")
	page, _ := parsePage(c)
	pageSize := 50
	me := currentUserFromCookie(c, h.Sessions)
	key := "comments:post:" + id + ":" + itoa(page)
	if me == "" {
		if v, ok := h.Cache.Comments.Get(key); ok {
			c.Header("X-Cache", "HIT")
			c.JSON(http.StatusOK, v)
			return
		}
	}
	comments, err := h.DB.GetPostComments(c.Request.Context(), id, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "查询失败"})
		return
	}
	resp := gin.H{"success": true, "comments": comments, "page": page, "page_size": pageSize}
	if me != "" {
		// 含个人点赞状态，不走共享缓存
		markCommentLikedByMe(h.DB, c.Request.Context(), me, comments)
		c.Header("X-Cache", "BYPASS")
	} else {
		h.Cache.Comments.Set(key, resp, 60*time.Second)
		c.Header("X-Cache", "MISS")
	}
	c.JSON(http.StatusOK, resp)
}

// ---- POST /api/v1/posts/:id/comments ----

type createCommentReq struct {
	Content  string  `json:"content" binding:"required"`
	ParentID *string `json:"parent_id"`
}

// CreateComment 评论/回复。
func (h *PostsHandler) CreateComment(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	postID := c.Param("id")
	var req createCommentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" || len([]rune(content)) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "内容需1-500字符"})
		return
	}
	comment, err := h.DB.AddComment(c.Request.Context(), postID, uid, content, req.ParentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "评论失败"})
		return
	}
	// 异步通知
	go h.notifyComment(comment)
	h.Cache.Comments.DeletePrefix("comments:post:" + postID)
	h.Cache.PostDetail.Delete("post:detail:" + postID)
	c.JSON(http.StatusCreated, gin.H{"success": true, "comment": comment})
}

func (h *PostsHandler) notifyComment(comment *models.Comment) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// 回复则通知父评论作者，否则通知帖子作者；跳过自己给自己评论/回复自己的情况
	var targetUserID, targetEmail string
	if comment.ParentID != nil && *comment.ParentID != "" {
		pc, err := h.DB.GetComment(ctx, *comment.ParentID)
		if err == nil && pc != nil {
			u, err2 := h.DB.GetUserByID(ctx, pc.UserID)
			if err2 == nil {
				targetUserID = u.ID
				targetEmail = u.Email
			}
		}
	} else {
		post, err := h.DB.GetPost(ctx, comment.PostID)
		if err == nil && post != nil {
			u, err2 := h.DB.GetUserByID(ctx, post.UserID)
			if err2 == nil {
				targetUserID = u.ID
				targetEmail = u.Email
			}
		}
	}
	if targetEmail == "" || targetUserID == comment.UserID {
		return
	}
	plain := "你收到一条新回复：\n" + comment.Content
	html := email.BuildHTML("评论通知", "收到新回复", []string{"你收到一条新回复：", comment.Content}, "", "", "")
	_, _ = h.Mailer.Send("【妖精论坛】收到新回复", plain, []string{targetEmail}, html)
}

// ---- DELETE /api/v1/comments/:id ----

// DeleteComment 删除评论（仅作者）。
func (h *PostsHandler) DeleteComment(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	id := c.Param("id")
	ok, err := h.DB.DeleteComment(c.Request.Context(), id, uid)
	if err != nil || !ok {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权限删除该评论"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ---- POST /api/v1/comments/:id/like ----

// LikeComment 评论点赞切换。
func (h *PostsHandler) LikeComment(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	id := c.Param("id")
	comment, err := h.DB.GetComment(c.Request.Context(), id)
	if err != nil || comment == nil || comment.Status != 1 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "评论不存在"})
		return
	}
	liked, likes, err := h.DB.LikeComment(c.Request.Context(), id, uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "操作失败"})
		return
	}
	// 使评论列表与帖子详情缓存失效
	h.Cache.Comments.DeletePrefix("comments:post:" + comment.PostID)
	h.Cache.PostDetail.Delete("post:detail:" + comment.PostID)
	c.JSON(http.StatusOK, gin.H{"success": true, "liked": liked, "likes": likes})
}

// markCommentLikedByMe 批量填充评论的 liked_by_me。
func markCommentLikedByMe(db *database.DB, ctx context.Context, me string, comments []models.Comment) {
	if len(comments) == 0 {
		return
	}
	ids := make([]string, 0, len(comments))
	for i := range comments {
		ids = append(ids, comments[i].ID)
	}
	liked, err := db.GetLikedCommentIDs(ctx, me, ids)
	if err != nil {
		return
	}
	for i := range comments {
		comments[i].LikedByMe = liked[comments[i].ID]
	}
}
