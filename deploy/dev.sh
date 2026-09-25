#!/usr/bin/env bash
# 妖精论坛 ov2 开发环境一键起服脚本
# 用途：启动 Go 后端(:8090) + Next.js(:3200)，开发数据库为本机 Docker PGSQL
# 说明：Docker Desktop 未运行时自动拉起（deploy/docker-ensure.sh），数据库容器自动创建/启动（deploy/db-up.sh）
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_GO="${PORT_GO:-8090}"
PORT_WEB="${PORT_WEB:-3200}"

if [ ! -f "$ROOT/server/.env" ]; then
  echo "[!] 未找到 server/.env，请先执行: make setup"
  exit 1
fi

echo "==> [1/3] 准备 Docker 数据库（未启动时自动拉起 Docker Desktop）..."
bash "$ROOT/deploy/db-up.sh"

echo "==> [2/3] 启动 Go 后端 (:${PORT_GO})..."
cd "$ROOT/server"
if [ "$APP_ENV" = "prod" ]; then
  go build -o bin/yj-forum ./cmd/yj-forum
  (PORT=$PORT_GO ./bin/yj-forum &)
else
  (PORT=$PORT_GO go run ./cmd/yj-forum &)
fi

echo "==> [3/3] 启动 Next.js 前端 (:${PORT_WEB})..."
cd "$ROOT/web"
PORT=$PORT_WEB pnpm dev &

echo
echo "✅ 开发环境已启动："
echo "   前端:  http://localhost:${PORT_WEB}"
echo "   后端:  http://localhost:${PORT_GO}/api/v1"
echo "   数据库: postgres://postgres:localdev123@localhost:5432/yj_forum"
echo "   (Ctrl+C 停止；生产请用 deploy/yj-forum.service 与 deploy/yj-web.service)"
wait
