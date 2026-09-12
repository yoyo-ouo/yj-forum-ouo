# ============================================================
# 妖精论坛 ov2 — 统一构建/开发入口
# 用法：make help 查看全部命令；make dev 一键起开发环境
# ============================================================

SHELL := /bin/bash
ROOT  := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
SERVER := server
WEB    := web
BIN    := $(SERVER)/bin/yj-forum

.DEFAULT_GOAL := help

.PHONY: help dev setup docker-up db-up db-down db-logs server server-run server-build web web-dev web-build web-start vet clean

help: ## 显示本帮助
	@echo "妖精论坛 ov2 开发命令："
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ---- 一键 ----------------

dev: ## 一键起开发环境（Docker PGSQL + Go 后端 :8080 + Next.js 前端 :3200）
	@bash $(ROOT)/deploy/dev.sh

setup: ## 初始化配置（生成 server/.env）
	@test -f $(SERVER)/.env || cp $(SERVER)/.env.example $(SERVER)/.env
	@echo "已生成 $(SERVER)/.env，请按需修改 SECRET_KEY / SMTP / 存储路径等"

# ---- Docker / 数据库 ----------------

docker-up: ## 确保本机 Docker 可用（未运行时自动启动 Docker Desktop）
	@bash $(ROOT)/deploy/docker-ensure.sh

db-up: ## 启动本机开发数据库容器（ouo-postgres :5432，自动拉起本机 Docker）
	@bash $(ROOT)/deploy/db-up.sh

db-down: ## 停止开发数据库容器
	@if docker stop ouo-postgres >/dev/null 2>&1; then \
		echo "ouo-postgres 已停止"; \
	elif ! docker info >/dev/null 2>&1; then \
		echo "Docker 未运行，ouo-postgres 已随之停止"; \
	else \
		echo "ouo-postgres 未运行"; \
	fi

db-logs: ## 查看数据库容器日志（需 Docker 在运行）
	@if ! docker info >/dev/null 2>&1; then \
		echo "[!] Docker 未运行，请先执行: make docker-up"; exit 1; \
	fi
	@docker logs -f ouo-postgres

# ---- 后端 ----------------

server: ## 仅启动 Go 后端（go run，任意目录下执行均可，迁移自动执行）
	@cd $(ROOT)/$(SERVER) && go run ./cmd/yj-forum

server-run: ## 一键编译并运行后端二进制（build + 启动）
	@cd $(ROOT)/$(SERVER) && go build -o bin/yj-forum ./cmd/yj-forum && exec ./bin/yj-forum

server-build: ## 仅编译后端二进制到 $(BIN)
	@cd $(ROOT)/$(SERVER) && go build -o bin/yj-forum ./cmd/yj-forum && echo "已生成 $(BIN)"

# ---- 前端 ----------------

web-dev: ## 启动 Next.js 开发服务器（:3200）
	@cd $(ROOT)/$(WEB) && pnpm dev -p 3200

web-build: ## 构建 Next.js 生产产物（.next）
	@cd $(ROOT)/$(WEB) && pnpm build

web-start: ## 运行 Next.js 生产服务器（:3200，需先执行 web-build）
	@cd $(ROOT)/$(WEB) && pnpm start -p 3200

web: web-dev ## 别名：同 web-dev

# ---- 质量 / 清理 ----------------

vet: ## go vet + 格式检查
	@cd $(ROOT)/$(SERVER) && go vet ./... && (gofmt -l . | grep -v '^$$' || true)

clean: ## 清理编译产物
	@rm -f $(ROOT)/$(BIN) && echo "已清理 $(BIN)"
