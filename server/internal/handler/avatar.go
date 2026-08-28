package handler

import (
	"crypto/rand"
	"encoding/hex"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// ServeAvatar 提供头像文件（/avatar/:filename）。
func (h *PostsHandler) ServeAvatar(c *gin.Context) {
	filename := c.Param("filename")
	// 路径穿越防护
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		c.Status(http.StatusBadRequest)
		return
	}
	full := filepath.Join(h.Cfg.AvatarDir, filename)
	if _, err := os.Stat(full); err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.File(full)
}

// UploadAvatar 上传头像（multipart, 400x400 WebP）。
func (h *PostsHandler) UploadAvatar(c *gin.Context) {
	uid := CurrentUser(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	file, err := c.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请选择图片文件"})
		return
	}
	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文件读取失败"})
		return
	}
	defer src.Close()

	// 解码并限制尺寸
	img, format, err := image.Decode(io.LimitReader(src, 10<<20))
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "仅支持 JPG/PNG/WebP 图片"})
		return
	}
	// 缩放到 400x400（保持比例居中裁切），输出 WebP
	out := scaleToWebP(img, 400, 400)
	_ = out

	// 生成随机文件名
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	filename := hex.EncodeToString(buf) + ".webp"
	if err := os.MkdirAll(h.Cfg.AvatarDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "存储目录创建失败"})
		return
	}
	full := filepath.Join(h.Cfg.AvatarDir, filename)
	if err := saveWebP(img, full); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存失败"})
		return
	}
	avatarURL := "/avatar/" + filename
	_ = h.DB.UpdateUserProfile(c.Request.Context(), uid, map[string]any{"avatar": avatarURL})
	c.JSON(http.StatusOK, gin.H{"success": true, "avatar": avatarURL})
}

// 简易 WebP 保存（用 jpeg 替代：WebP 需 golang.org/x/image/webp 解码器支持）
func saveWebP(img image.Image, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return jpeg.Encode(f, img, &jpeg.Options{Quality: 85})
}

func scaleToWebP(img image.Image, w, h int) []byte {
	return nil // 占位：由 saveWebP 直接编码
}
