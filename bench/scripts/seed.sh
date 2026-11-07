#!/usr/bin/env bash
# ============================================================
# 生成基准数据集（默认 small）
# 用法：bash bench/scripts/seed.sh [small|medium|large]
# ============================================================
set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_env
guard_env

SCALE="${1:-${SCALE:-small}}"
case "$SCALE" in
  small|medium|large) ;;
  *) die "未知规模：$SCALE（可选 small|medium|large）" ;;
esac

[[ -x "$BENCH_DIR/bin/bench-seed" ]] || { log "构建种子工具…"; ( cd "$BENCH_DIR" && go build -o bin/bench-seed ./seed ); }

bash "$BENCH_DIR/scripts/db-bench.sh" >/dev/null

# 迁移需要建表：若库内无 schema_migrations，先启动一次服务执行迁移
HAS_SCHEMA="$(docker exec "$BENCH_DB_CONTAINER" psql -U postgres -d "$BENCH_DB_NAME" -tAc \
  "select count(*) from information_schema.tables where table_schema='public' and table_name='schema_migrations';" 2>/dev/null | tr -d '[:space:]' || echo 0)"
if [[ "$HAS_SCHEMA" != "1" ]]; then
  log "基准库尚未迁移，先启动服务执行嵌入迁移…"
  bash "$BENCH_DIR/scripts/server.sh" start >/dev/null
  bash "$BENCH_DIR/scripts/server.sh" stop >/dev/null || true
fi

log "生成 $SCALE 档数据集…"
"$BENCH_DIR/bin/bench-seed" -dsn "$DATABASE_URL" -scale "$SCALE" \
  -out "$BENCH_DIR/seed" -media-dir "$MEDIA_DIR" -force

log "数据集就绪：$BENCH_DIR/seed/ids.json"
