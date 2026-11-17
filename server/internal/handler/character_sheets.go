package handler

// 设定记录（角色设定卡）：用户端 CRUD、草稿自动保存、发布、点赞、引用选择器搜索。

import (
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/auth"
	"yj-forum/server/internal/database"
	"yj-forum/server/internal/models"
	"yj-forum/server/internal/sanitize"
)

// CharacterSheetsHandler 设定记录路由处理器。
type CharacterSheetsHandler struct {
	DB       *database.DB
	Sessions *auth.SessionManager
}

const (
	characterMaxNameRunes    = 24
	characterMaxShortRunes   = 32
	characterMaxGuildRunes   = 64
	characterMaxAbilities    = 10
	characterAbilityMaxRunes = 60
	characterMaxImages       = 3
	characterMaxQuotes       = 20
	characterQuoteMaxRunes   = 120
	characterMaxDescBytes    = 64 * 1024
	// 描述里的节点上限（与帖子同口径，防超大 DOM 拖垮渲染）
	characterMaxDescImages = 20
	characterMaxDescEmbeds = 10
)

// characterMediaIDRe 媒体 ID 白名单（MD + 16~64 位 hex），避免超长/非法值写入 DB 触发 500。
var characterMediaIDRe = regexp.MustCompile(`^MD[0-9a-fA-F]{16,64}$`)

// characterCategories 能力六大系白名单。
var characterCategories = map[string]struct{}{
	"御灵系": {}, "生灵系": {}, "锁御系": {}, "造物系": {}, "心灵系": {}, "空间系": {},
}

// normalizeCharacterPayload 校验并归一化负载；返回空串表示通过。
// strict=true（发布）时额外要求必填项与至少一项能力；草稿只做长度/枚举校验。
func normalizeCharacterPayload(in *models.CharacterSheetPayload, strict bool) string {
	in.Name = strings.TrimSpace(in.Name)
	in.Alias = strings.TrimSpace(in.Alias)
	in.Title = strings.TrimSpace(in.Title)
	in.Age = strings.TrimSpace(in.Age)
	in.Build = strings.TrimSpace(in.Build)
	in.Species = strings.TrimSpace(in.Species)
	in.Identity = strings.TrimSpace(in.Identity)
	in.AvatarMediaID = strings.TrimSpace(in.AvatarMediaID)
	in.Guild.CustomName = strings.TrimSpace(in.Guild.CustomName)

	if utf8.RuneCountInString(in.Name) > characterMaxNameRunes {
		return "名字不能超过 24 个字符"
	}
	for _, v := range []string{in.Alias, in.Title} {
		if utf8.RuneCountInString(v) > characterMaxNameRunes {
			return "别称/称号不能超过 24 个字符"
		}
	}
	for _, v := range []string{in.Age, in.Build, in.Species, in.Identity} {
		if utf8.RuneCountInString(v) > characterMaxShortRunes {
			return "年龄/体态/物种/身份不能超过 32 个字符"
		}
	}
	if in.Gender < 0 || in.Gender > 2 {
		return "性别取值不合法"
	}

	if len(in.DescriptionHTML) > characterMaxDescBytes {
		return "角色描述过长"
	}
	in.DescriptionHTML = sanitize.SanitizeRichContent(in.DescriptionHTML)
	if strings.Count(in.DescriptionHTML, "<img") > characterMaxDescImages {
		return "角色描述里的图片不能超过 20 张"
	}
	if strings.Count(in.DescriptionHTML, "data-embed=") > characterMaxDescEmbeds {
		return "角色描述里的引用卡片不能超过 10 个"
	}

	if in.AvatarMediaID != "" && !characterMediaIDRe.MatchString(in.AvatarMediaID) {
		return "头像媒体标识不合法"
	}

	images := make([]string, 0, len(in.ImageMediaIDs))
	seen := make(map[string]struct{}, len(in.ImageMediaIDs))
	for _, raw := range in.ImageMediaIDs {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if !characterMediaIDRe.MatchString(id) {
			return "图片媒体标识不合法"
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		images = append(images, id)
	}
	if len(images) > characterMaxImages {
		return "图片最多上传 3 张"
	}
	in.ImageMediaIDs = images

	abilities := make([]models.CharacterAbility, 0, len(in.Abilities))
	for _, a := range in.Abilities {
		a.Category = strings.TrimSpace(a.Category)
		a.Detail = strings.TrimSpace(a.Detail)
		if _, ok := characterCategories[a.Category]; !ok {
			return "能力类型只能选择六大系之一"
		}
		if utf8.RuneCountInString(a.Detail) > characterAbilityMaxRunes {
			return "单项能力描述不能超过 60 个字符"
		}
		abilities = append(abilities, a)
	}
	if len(abilities) > characterMaxAbilities {
		return "能力最多 10 项"
	}
	in.Abilities = abilities

	quotes := make([]models.CharacterQuoteInput, 0, len(in.Quotes))
	for _, q := range in.Quotes {
		content := strings.TrimSpace(q.Content)
		if content == "" {
			continue
		}
		if utf8.RuneCountInString(content) > characterQuoteMaxRunes {
			return "单条语录不能超过 120 个字符"
		}
		quotes = append(quotes, models.CharacterQuoteInput{Content: content})
	}
	if len(quotes) > characterMaxQuotes {
		return "语录最多 20 条"
	}
	in.Quotes = quotes

	switch in.Guild.Mode {
	case "", "none":
		in.Guild = models.CharacterGuildRef{Mode: "none"}
	case "existing":
		if in.Guild.GuildID <= 0 {
			return "请选择要绑定的会馆"
		}
		in.Guild.CustomName = ""
	case "custom":
		if utf8.RuneCountInString(in.Guild.CustomName) > characterMaxGuildRunes {
			return "会馆名称不能超过 64 个字符"
		}
		in.Guild.GuildID = 0
	default:
		return "会馆选择方式不合法"
	}

	if strict {
		if in.Name == "" {
			return "请填写名字"
		}
		if in.Age == "" {
			return "请填写年龄"
		}
		if in.Build == "" {
			return "请填写体态"
		}
		if len(in.Abilities) == 0 {
			return "请至少添加一项能力"
		}
		if sanitize.StripTagsAndTrim(in.DescriptionHTML) == "" {
			return "请填写角色描述"
		}
	}
	return ""
}

// characterErrStatus 将数据层错误映射为 HTTP 状态与提示。
func characterErrStatus(err error) (int, string) {
	switch {
	case errors.Is(err, database.ErrCharacterSheetNotFound):
		return http.StatusNotFound, "设定不存在"
	case errors.Is(err, database.ErrCharacterSheetNotOwner):
		return http.StatusForbidden, "无权操作该设定"
	case errors.Is(err, database.ErrCharacterSheetSelfLike):
		return http.StatusBadRequest, "不能给自己的设定点赞"
	case errors.Is(err, database.ErrCharacterSheetLimit):
		return http.StatusBadRequest, "角色数量已达上限（20 个）"
	}
	return http.StatusInternalServerError, "操作失败"
}

func characterFail(c *gin.Context, err error) {
	status, msg := characterErrStatus(err)
	if status == http.StatusInternalServerError {
		log.Printf("[character_sheet] %s %s 失败: %v", c.Request.Method, c.Request.URL.Path, err)
	}
	c.JSON(status, gin.H{"success": false, "message": msg})
}

// ---- GET /ov2/api/character-sheets/mine ----

// Mine 我的全部设定（含草稿与草稿内容）。
func (h *CharacterSheetsHandler) Mine(c *gin.Context) {
	uid := CurrentUser(c)
	sheets, err := h.DB.ListCharacterSheetsByUser(c.Request.Context(), uid, uid, true)
	if err != nil {
		characterFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "items": sheets})
}

// ---- GET /ov2/api/character-sheets/user/:userId ----

// ByUser 某用户的设定（公开）；本人可见草稿。
func (h *CharacterSheetsHandler) ByUser(c *gin.Context) {
	userID := strings.TrimSpace(c.Param("userId"))
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "缺少用户"})
		return
	}
	viewer := currentUserFromCookie(c, h.Sessions)
	includeDrafts := viewer != "" && viewer == userID
	sheets, err := h.DB.ListCharacterSheetsByUser(c.Request.Context(), userID, viewer, includeDrafts)
	if err != nil {
		characterFail(c, err)
		return
	}
	resp := gin.H{"success": true, "items": sheets}
	if includeDrafts {
		resp["prompt_seen"] = h.DB.CharacterPromptSeen(c.Request.Context(), userID)
	}
	c.JSON(http.StatusOK, resp)
}

// ---- GET /ov2/api/character-sheets/:id ----

// Detail 设定详情；未公开的只有作者本人可读。
func (h *CharacterSheetsHandler) Detail(c *gin.Context) {
	viewer := currentUserFromCookie(c, h.Sessions)
	s, err := h.DB.GetCharacterSheet(c.Request.Context(), c.Param("id"), viewer)
	if err != nil {
		characterFail(c, err)
		return
	}
	if s.Status != 1 && !s.Mine {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "设定不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "item": s})
}

// ---- POST /ov2/api/character-sheets ----

// Create 新建空角色（草稿态）。
func (h *CharacterSheetsHandler) Create(c *gin.Context) {
	uid := CurrentUser(c)
	id, err := h.DB.CreateCharacterSheet(c.Request.Context(), uid)
	if err != nil {
		characterFail(c, err)
		return
	}
	s, err := h.DB.GetCharacterSheet(c.Request.Context(), id, uid)
	if err != nil {
		characterFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "item": s})
}

// ---- PUT /ov2/api/character-sheets/:id/draft ----

// SaveDraft 自动保存草稿。
func (h *CharacterSheetsHandler) SaveDraft(c *gin.Context) {
	uid := CurrentUser(c)
	var in models.CharacterSheetPayload
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
		return
	}
	if msg := normalizeCharacterPayload(&in, false); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	savedAt, err := h.DB.SaveCharacterDraft(c.Request.Context(), c.Param("id"), uid, &in)
	if err != nil {
		characterFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "saved_at": savedAt})
}

// ---- POST /ov2/api/character-sheets/:id/publish ----

// Publish 发布 / 发布新版本。
func (h *CharacterSheetsHandler) Publish(c *gin.Context) {
	uid := CurrentUser(c)
	var in models.CharacterSheetPayload
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
		return
	}
	if msg := normalizeCharacterPayload(&in, true); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": msg})
		return
	}
	s, err := h.DB.PublishCharacterSheet(c.Request.Context(), c.Param("id"), uid, &in)
	if err != nil {
		characterFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "item": s})
}

// ---- DELETE /ov2/api/character-sheets/:id/draft ----

// DiscardDraft 放弃草稿；从未发布过的角色直接删除。
func (h *CharacterSheetsHandler) DiscardDraft(c *gin.Context) {
	uid := CurrentUser(c)
	id := c.Param("id")
	s, err := h.DB.GetCharacterSheet(c.Request.Context(), id, uid)
	if err != nil {
		characterFail(c, err)
		return
	}
	if !s.Mine {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权操作该设定"})
		return
	}
	if s.Status == 0 {
		err = h.DB.DeleteCharacterSheet(c.Request.Context(), id, uid)
	} else {
		err = h.DB.DiscardCharacterDraft(c.Request.Context(), id, uid)
	}
	if err != nil {
		characterFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ---- DELETE /ov2/api/character-sheets/:id ----

// Delete 删除角色。
func (h *CharacterSheetsHandler) Delete(c *gin.Context) {
	uid := CurrentUser(c)
	if err := h.DB.DeleteCharacterSheet(c.Request.Context(), c.Param("id"), uid); err != nil {
		characterFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ---- POST /ov2/api/character-sheets/:id/like ----

// Like 点赞 / 取消。
func (h *CharacterSheetsHandler) Like(c *gin.Context) {
	uid := CurrentUser(c)
	id := c.Param("id")
	liked, count, ownerID, name, err := h.DB.ToggleCharacterSheetLike(c.Request.Context(), id, uid)
	if err != nil {
		characterFail(c, err)
		return
	}
	if liked {
		h.notifyCharacterLike(c, id, uid, ownerID, name)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "liked": liked, "likes": count})
}

// notifyCharacterLike 设定被赞后给作者写站内通知（跳过自赞；dedupe 防重复）。
func (h *CharacterSheetsHandler) notifyCharacterLike(c *gin.Context, sheetID, actorID, ownerID, name string) {
	if ownerID == "" || ownerID == actorID {
		return
	}
	ctx := c.Request.Context()
	actorName, actorAvatar := actorID, ""
	if u, err := h.DB.GetUserByID(ctx, actorID); err == nil && u != nil {
		actorName, actorAvatar = u.Name, u.Avatar
	}
	in := database.NotificationInput{
		UserID: ownerID, Type: database.NotificationCharacterLike, ActorID: actorID,
		TargetType: "character", TargetID: sheetID,
		Payload:   map[string]any{"character_id": sheetID, "character_name": name, "actor_name": actorName},
		DedupeKey: "character_like:" + sheetID + ":" + actorID,
	}
	notifID, created, err := h.DB.CreateNotification(ctx, in)
	if err != nil || !created {
		return
	}
	PushNotificationEvent(ownerID, notifID, gin.H{
		"id": notifID, "type": in.Type, "actor_id": actorID, "actor_name": actorName, "actor_avatar": actorAvatar,
		"target_type": "character", "target_id": sheetID, "character_id": sheetID, "character_name": name,
	})
	PushUnreadEvent(ctx, h.DB, ownerID)
}

// ---- GET /ov2/api/character-sheets/search ----

// Search 引用选择器：空关键词返回最新公开设定。
func (h *CharacterSheetsHandler) Search(c *gin.Context) {
	page, pageSize := parsePageWithDefault(c, 10)
	// 与数据层上限保持一致（>50 会被回退为默认值，调用方无法感知）
	if pageSize > 50 {
		pageSize = 50
	}
	viewer := currentUserFromCookie(c, h.Sessions)
	sheets, hasMore, err := h.DB.SearchCharacterSheets(c.Request.Context(), c.Query("k"), viewer, page, pageSize)
	if err != nil {
		characterFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "items": sheets, "has_more": hasMore, "page": page})
}

// ---- POST /ov2/api/character-sheets/prompt-seen ----

// PromptSeen 标记注册引导已展示（只弹一次）。
func (h *CharacterSheetsHandler) PromptSeen(c *gin.Context) {
	if err := h.DB.MarkCharacterPromptSeen(c.Request.Context(), CurrentUser(c)); err != nil {
		characterFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
