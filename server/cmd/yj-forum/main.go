// yj-forum-server 妖精论坛 v2 后端服务
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/auth"
	"yj-forum/server/internal/config"
	"yj-forum/server/internal/database"
	"yj-forum/server/internal/email"
	"yj-forum/server/internal/handler"
)

func main() {
	cfg := config.Load()

	if cfg.SecretKey == "" {
		log.Println("[WARN] SECRET_KEY 未设置，使用开发默认值")
		cfg.SecretKey = "dev-secret-key"
	}

	// 1. 数据库
	ctx := context.Background()
	db, err := database.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("[FATAL] 数据库初始化失败: %v", err)
	}
	defer db.Close()

	// 2. 迁移（golang-migrate，嵌入二进制，无工作目录依赖）
	if err := database.Migrate(cfg.DatabaseURL); err != nil {
		log.Printf("[WARN] 迁移执行失败（表可能已存在）: %v", err)
	} else {
		log.Println("[DB] 迁移完成")
	}

	// 3. 会话/邮件
	sessions := &auth.SessionManager{DB: db}
	mailer := email.New(cfg.SMTPEnabled, cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFromName, cfg.ReceiverAll)

	// 4. 路由
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	handler.Register(r, cfg, db, sessions, mailer)

	// 5. 后台清理任务
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			sessions.Cleanup(ctx)
			_ = db.CleanExpiredVerifyCodes(ctx)
		}
	}()

	// 6. HTTP 服务
	srv := &http.Server{
		Addr:    cfg.Host + ":" + cfg.Port,
		Handler: r,
	}

	go func() {
		log.Printf("[SERVER] 妖精论坛 v2 后端启动: http://%s:%s", cfg.Host, cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[FATAL] 服务启动失败: %v", err)
		}
	}()

	// 优雅退出
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("[SERVER] 正在关闭...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
