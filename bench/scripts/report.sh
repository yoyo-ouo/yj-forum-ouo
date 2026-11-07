#!/usr/bin/env bash
# ============================================================
# 重新生成最近一次（或指定 RUN_ID）的报告
# 用法：bash bench/scripts/report.sh [run-id]
# ============================================================
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[[ -x "$BENCH_DIR/bin/bench-report" ]] || ( cd "$BENCH_DIR" && go build -o bin/bench-report ./report )

RUN_ID="${1:-}"
if [[ -n "$RUN_ID" ]]; then
  RESULTS="$RESULTS_ROOT/$RUN_ID"
else
  RESULTS="$(ls -1dt "$RESULTS_ROOT"/*/ 2>/dev/null | head -1 || true)"
  RESULTS="${RESULTS%/}"
fi
[[ -n "$RESULTS" && -d "$RESULTS" ]] || die "找不到跑分结果目录"

"$BENCH_DIR/bin/bench-report" -results "$RESULTS" \
  -scenarios "$BENCH_DIR/config/scenarios.json" \
  -baseline-root "$BASELINE_ROOT"
log "报告：$RESULTS/report.md（HTML：$RESULTS/report.html）"
