#!/usr/bin/env bash
# ============================================================
# 启动/确保本机开发数据库容器（ouo-postgres :5432）
# - 自动拉起 Docker（调用 deploy/docker-ensure.sh）
# - 容器不存在则创建、存在未运行则启动、已运行则跳过（幂等）
# - 等待 PostgreSQL 就绪并确保 yj_forum 数据库存在
# 用法：bash deploy/db-up.sh [Docker 启动超时秒数]
# ============================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="ouo-postgres"
IMAGE="postgres:18"
PASSWORD="localdev123"
DB="yj_forum"

# 1) 确保 Docker 守护进程可用（Docker Desktop 未运行时会自动启动）
bash "$ROOT/deploy/docker-ensure.sh" "$@" || exit 1

# 2) 确保容器存在且运行中
if ! docker inspect "$NAME" >/dev/null 2>&1; then
  echo "创建数据库容器 ${NAME}（${IMAGE}）…"
  docker run -d --name "$NAME" --restart unless-stopped \
    -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB="$DB" \
    -p 5432:5432 "$IMAGE" >/dev/null
elif [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != "true" ]; then
  echo "启动已有容器 ${NAME}…"
  docker start "$NAME" >/dev/null
else
  echo "容器 ${NAME} 已在运行"
fi

# 3) 等待 PostgreSQL 就绪（最长 60s，容器中途退出则立即报错）
echo -n "等待 PostgreSQL 就绪"
ok=""
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then
    ok=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)" != "true" ]; then
    printf '\n'
    echo "[!] 容器 ${NAME} 已退出，最近日志：" >&2
    docker logs --tail 20 "$NAME" 2>&1 | sed 's/^/      /' >&2
    exit 1
  fi
  printf '.'
  sleep 1
done
printf '\n'
if [ -z "$ok" ]; then
  echo "[!] PostgreSQL 在 60 秒内未就绪，可执行 'make db-logs' 查看日志。" >&2
  exit 1
fi

# 4) 确保 yj_forum 数据库存在（兼容已存在但缺库的容器）
docker exec "$NAME" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" | grep -q 1 || \
  docker exec "$NAME" psql -U postgres -c "CREATE DATABASE ${DB}" >/dev/null

echo "✅ 数据库就绪: postgresql://postgres:${PASSWORD}@127.0.0.1:5432/${DB}"
