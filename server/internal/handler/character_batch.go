package handler

// 角色批量添加：配额查询、解析预览、正式批量创建。
//
// 约定：
//   - 预览只解析 + 查配额，不写任何角色数据（仅写预览凭证表）；
//   - 正式提交必须带预览凭证，服务端重新解析原文并在事务内重查配额；
//   - 凭证绑定用户 + 原文摘要，有效期 10 分钟，首次提交前需清 3 秒；
//   - 同一凭证重复提交直接回放首次结果（幂等）。

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/database"
	"yj-forum/server/internal/models"
)

const (
	characterBatchPreviewTTL  = 10 * time.Minute
	characterBatchWaitSeconds = 3 * time.Second
	// characterBatchBodySlack 请求体上限 = 原文上限 + JSON 包装/凭证余量
	characterBatchBodySlack = 8 * 1024
)

// characterBatchTokenRe 预览凭证：32 字节随机数的 hex（64 位小写）。
var characterBatchTokenRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

type characterBatchContentRequest struct {
	Content string `json:"content"`
}

type characterBatchCreateRequest struct {
	Content string `json:"content"`
	Token   string `json:"token"`
}

func characterQuota(used int) models.CharacterQuota {
	remaining := database.CharacterMaxPerUser - used
	if remaining < 0 {
		remaining = 0
	}
	return models.CharacterQuota{Used: used, Max: database.CharacterMaxPerUser, Remaining: remaining}
}

func characterBatchContentHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func characterBatchTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newCharacterBatchToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// bindCharacterBatchJSON 限制请求体大小后绑定 JSON。
func bindCharacterBatchJSON(c *gin.Context, dst any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, characterBatchMaxBytes+characterBatchBodySlack)
	if err := c.ShouldBindJSON(dst); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false, "code": "INVALID_BODY", "message": "请求格式错误",
		})
		return false
	}
	return true
}

// ---- GET /ov2/api/character-sheets/quota ----

// Quota 当前用户的角色配额（全部状态均计入）。
func (h *CharacterSheetsHandler) Quota(c *gin.Context) {
	used, err := h.DB.CountCharacterSheets(c.Request.Context(), CurrentUser(c))
	if err != nil {
		characterBatchFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "quota": characterQuota(used)})
}

// ---- POST /ov2/api/character-sheets/batch/preview ----

// BatchPreview 解析预览：只做解析与配额检查，不创建/修改任何角色。
func (h *CharacterSheetsHandler) BatchPreview(c *gin.Context) {
	uid := CurrentUser(c)
	var in characterBatchContentRequest
	if !bindCharacterBatchJSON(c, &in) {
		return
	}
	items, parseErrs := parseCharacterBatch(in.Content)
	if len(parseErrs) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"code":    "PARSE_FAILED",
			"message": fmt.Sprintf("存在 %d 处解析错误", len(parseErrs)),
			"errors":  parseErrs,
		})
		return
	}

	used, err := h.DB.CountCharacterSheets(c.Request.Context(), uid)
	if err != nil {
		characterBatchFail(c, err)
		return
	}
	quota := characterQuota(used)
	withinQuota := len(items) <= quota.Remaining
	resp := gin.H{
		"success":      true,
		"items":        items,
		"count":        len(items),
		"quota":        quota,
		"within_quota": withinQuota,
		"token":        "",
		"expires_at":   nil,
		"not_before":   nil,
	}

	if withinQuota {
		token, err := newCharacterBatchToken()
		if err != nil {
			characterBatchFail(c, err)
			return
		}
		createdAt, expiresAt, err := h.DB.CreateCharacterBatchPreview(
			c.Request.Context(), characterBatchTokenHash(token), uid,
			characterBatchContentHash(in.Content), len(items), characterBatchPreviewTTL)
		if err != nil {
			characterBatchFail(c, err)
			return
		}
		resp["token"] = token
		resp["expires_at"] = expiresAt
		resp["not_before"] = createdAt.Add(characterBatchWaitSeconds)
	}

	c.JSON(http.StatusOK, resp)
}

// ---- POST /ov2/api/character-sheets/batch ----

// BatchCreate 正式批量创建（全部草稿）。
func (h *CharacterSheetsHandler) BatchCreate(c *gin.Context) {
	uid := CurrentUser(c)
	var in characterBatchCreateRequest
	if !bindCharacterBatchJSON(c, &in) {
		return
	}
	token := strings.TrimSpace(in.Token)
	if !characterBatchTokenRe.MatchString(token) {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false, "code": "PREVIEW_INVALID",
			"message": "预览凭证无效，请重新解析预览",
		})
		return
	}

	// 不信任前端回传的任何解析结果：用原始文本重新解析并校验。
	items, parseErrs := parseCharacterBatch(in.Content)
	if len(parseErrs) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"code":    "PARSE_FAILED",
			"message": fmt.Sprintf("存在 %d 处解析错误", len(parseErrs)),
			"errors":  parseErrs,
		})
		return
	}

	payloads := make([]*models.CharacterSheetPayload, len(items))
	identifiers := make([]string, len(items))
	for i := range items {
		payloads[i] = &items[i].Payload
		identifiers[i] = items[i].Identifier
	}

	res, err := h.DB.CreateCharacterSheetsBatch(c.Request.Context(), database.CharacterBatchSubmit{
		TokenHash:   characterBatchTokenHash(token),
		UserID:      uid,
		ContentHash: characterBatchContentHash(in.Content),
		Identifiers: identifiers,
		Payloads:    payloads,
	})
	if err != nil {
		switch {
		case errors.Is(err, database.ErrCharacterBatchTokenInvalid):
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false, "code": "PREVIEW_INVALID",
				"message": "预览已失效（内容被修改、凭证不属于当前用户或已过期），请重新解析预览",
			})
		case errors.Is(err, database.ErrCharacterBatchTokenExpired):
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false, "code": "PREVIEW_EXPIRED",
				"message": "预览已超过 10 分钟，请重新解析预览",
			})
		case errors.Is(err, database.ErrCharacterBatchTooEarly):
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false, "code": "PREVIEW_NOT_READY",
				"message": "请至少等待 3 秒后再确认",
			})
		case errors.Is(err, database.ErrCharacterSheetLimit):
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false, "code": "QUOTA_EXCEEDED",
				"message": fmt.Sprintf("角色数量将超过上限（%d 个），本次未创建任何角色", database.CharacterMaxPerUser),
			})
		default:
			characterBatchFail(c, err)
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"items":    res.Result.Items,
		"count":    len(res.Result.Items),
		"quota":    res.Result.Quota,
		"replayed": res.Replayed,
	})
}

func characterBatchFail(c *gin.Context, err error) {
	log.Printf("[character_batch] %s %s 失败: %v", c.Request.Method, c.Request.URL.Path, err)
	c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "操作失败"})
}
