#!/usr/bin/env bash
# ============================================================
# 基准数据库容器（ouo-postgres-bench :5433）
# - 与开发库 ouo-postgres(:5432) 完全隔离
# - 预加载 pg_stat_statements，便于 SQL 级归因
# 用法：bash bench/scripts/db-bench.sh [--reset]
#   --reset  删除容器后重建（清空所有基准数据）
# ============================================================
set -euo pipefail
source "$(dirname "$0")/lib.sh"

RESET=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "未知参数：$arg" ;;
  esac
done

require_cmd docker "请先启动 Docker"

if (( RESET )); then
  if docker inspect "$BENCH_DB_CONTAINER" >/dev/null 2>&1; then
    log "重建容器 $BENCH_DB_CONTAINER（清空基准数据）"
    docker rm -f "$BENCH_DB_CONTAINER" >/dev/null
  fi
fi

if ! docker inspect "$BENCH_DB_CONTAINER" >/dev/null 2>&1; then
  log "创建容器 $BENCH_DB_CONTAINER（postgres:18，:${BENCH_DB_PORT}）"
  docker run -d --name "$BENCH_DB_CONTAINER" --restart unless-stopped \
    -e POSTGRES_PASSWORD="$BENCH_DB_PASSWORD" \
    -e POSTGRES_DB="$BENCH_DB_NAME" \
    -p "127.0.0.1:${BENCH_DB_PORT}:5432" \
    postgres:18 \
    -c shared_preload_libraries=pg_stat_statements \
    -c pg_stat_statements.track=all \
    -c shared_buffers=1GB \
    -c effective_cache_size=3GB \
    -c work_mem=16MB \
    -c maintenance_work_mem=256MB \
    -c max_connections=200 \
    -c track_io_timing=on \
    -c log_min_duration_statement=200ms \
    -c random_page_cost=1.1 >/dev/null
elif [[ "$(docker inspect -f '{{.State.Running}}' "$BENCH_DB_CONTAINER")" != "true" ]]; then
  log "启动已有容器 $BENCH_DB_CONTAINER"
  docker start "$BENCH_DB_CONTAINER" >/dev/null
else
  log "容器 $BENCH_DB_CONTAINER 已在运行"
fi

log "等待 PostgreSQL 就绪…"
ok=""
for _ in $(seq 1 60); do
  if docker exec "$BENCH_DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[[ -n "$ok" ]] || die "基准库 60s 内未就绪，查看：docker logs $BENCH_DB_CONTAINER"

# 扩展（幂等）
docker exec "$BENCH_DB_CONTAINER" psql -U postgres -d "$BENCH_DB_NAME" -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;' >/dev/null

EXT_OK="$(docker exec "$BENCH_DB_CONTAINER" psql -U postgres -d "$BENCH_DB_NAME" -tAc \
  "select count(*) from pg_extension where extname='pg_stat_statements';" | tr -d '[:space:]')"
[[ "$EXT_OK" == "1" ]] || die "pg_stat_statements 未启用"

log "基准库就绪：postgresql://postgres:***@127.0.0.1:${BENCH_DB_PORT}/${BENCH_DB_NAME}（pg_stat_statements=on）"
