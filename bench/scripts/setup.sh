#!/usr/bin/env bash
# ============================================================
# 基准环境初始化：k6 / 工具链 / 数据库容器 / bench.env
# 用法：bash bench/scripts/setup.sh
# ============================================================
set -euo pipefail
source "$(dirname "$0")/lib.sh"

load_env
ensure_assets

if ! command -v k6 >/dev/null 2>&1; then
  require_cmd snap "未安装 k6 且无 snap，请手动安装 k6 v2.3.0"
  log "安装 k6（snap latest/stable）…"
  sudo snap install k6
else
  log "k6 已安装：$(k6 version | head -1)"
fi

log "构建基准工具（seed / sse / metrics / report）…"
( cd "$BENCH_DIR" && go build -o bin/bench-seed ./seed \
  && go build -o bin/bench-sse ./sse \
  && go build -o bin/bench-metrics ./metrics \
  && go build -o bin/bench-report ./report )

bash "$BENCH_DIR/scripts/db-bench.sh"

log "初始化完成。下一步：make bench-seed SCALE=small"
