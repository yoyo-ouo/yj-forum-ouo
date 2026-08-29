#!/usr/bin/env bash
# 妖精论坛 v2 开发环境一键起服脚本
# 用途：启动 Go 后端(:8080) + Next.js(:3001)，开发数据库为本机 Docker PGSQL
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_GO="${PORT_GO:-8080}"
PORT_WEB="${PORT_WEB:-3200}"

if [ ! -f "$ROOT/server/.env" ]; then
  echo "[!] 未找到 server/.env，请先执行: make setup"
  exit 1
fi

echo "==> [1/3] 检查 Docker PGSQL 容器..."
if ! docker ps --format '{{.Names}}' | grep -q ouo-postgres; then
  echo "启动本机 PGSQL 容器 (ouo-postgres)..."
  docker run -d --name ouo-postgres \
    -e POSTGRES_PASSWORD=localdev123 -e POSTGRES_DB=yj_forum \
    -p 5432:5432 postgres:18
else
  echo "    ouo-postgres 已在运行"
fi
# 确保数据库存在
docker exec ouo-postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='yj_forum'" | grep -q 1 || \
  docker exec ouo-postgres psql -U postgres -c "CREATE DATABASE yj_forum;"

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
