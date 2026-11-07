#!/usr/bin/env bash
# ============================================================
# 一键基准跑分（冷跑 + 热跑 + SSE + 指标采集 + 报告 + 基线）
# 用法：
#   SCALE=small|medium|large  PROFILES=full|smoke  PHASES=cold,warm|warm \
#   RATE/DURATION/PRE_VUS/MAX_VUS 可临时覆盖所有场景参数
#   bash bench/scripts/run.sh
# ============================================================
set -euo pipefail
source "$(dirname "$0")/lib.sh"

load_env
guard_env
ensure_dirs
ensure_assets

SCALE="${SCALE:-small}"
PROFILE="${PROFILE:-fast}"
PHASES="${PHASES:-cold,warm}"
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)-$SCALE}"
RESULTS="$RESULTS_ROOT/$RUN_ID"
MARK_FILE="$RESULTS/current.txt"
mkdir -p "$RESULTS/scenarios" "$RESULTS/logs"

assert_dev_services_stopped

FP_JSON="$(fingerprint_json)"
FP_KEY="$(printf '%s\n' "$FP_JSON" | sha256sum | cut -c1-12)"
CONFIG_HASH="$(sha256sum "$BENCH_DIR/config/scenarios.json" | cut -c1-12)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"run_id":"%s","scale":"%s","profile":"%s","fingerprint":%s,"fingerprint_key":"%s","config_hash":"%s","started_at":"%s"}\n' \
  "$RUN_ID" "$SCALE" "$PROFILE" "$FP_JSON" "$FP_KEY" "$CONFIG_HASH" "$STARTED" > "$RESULTS/run.json"

log "run=$RUN_ID scale=$SCALE profile=$PROFILE phases=$PHASES fingerprint=$FP_KEY"

# 工具链
for t in bench-seed bench-sse bench-metrics bench-report; do
  ( cd "$BENCH_DIR" && go build -o "bin/$t" "./${t#bench-}" ) || exit 1
done

bash "$BENCH_DIR/scripts/db-bench.sh"
bash "$BENCH_DIR/scripts/server.sh" start

# 数据集
NEED_SEED=0
if [[ ! -f "$BENCH_DIR/seed/ids.json" ]]; then
  NEED_SEED=1
else
  CUR_SCALE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["scale"])' "$BENCH_DIR/seed/ids.json" 2>/dev/null || echo '')"
  [[ "$CUR_SCALE" == "$SCALE" ]] || NEED_SEED=1
fi
if (( NEED_SEED )); then
  log "当前数据集不匹配（需要 $SCALE），重新生成…"
  bash "$BENCH_DIR/scripts/seed.sh" "$SCALE"
  bash "$BENCH_DIR/scripts/server.sh" restart
fi

# 指标采集（独立会话，防 SIGHUP）
setsid nohup "$BENCH_DIR/bin/bench-metrics" \
  -api "$BENCH_BASE_URL" -pid-file "$PID_FILE" -dsn "$DATABASE_URL" \
  -out "$RESULTS/metrics.jsonl" -mark-file "$MARK_FILE" -interval 1s \
  </dev/null >>"$RESULTS/logs/metrics.log" 2>&1 &
sleep 0.4
COLLECTOR_PID="$(pgrep -n -f "$BENCH_DIR/bin/bench-metrics" 2>/dev/null || echo "")"
cleanup() {
  [[ -n "$COLLECTOR_PID" ]] && kill "$COLLECTOR_PID" 2>/dev/null || true
  pkill -f "$BENCH_DIR/bin/bench-metrics" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

run_k6() {
  local phase="$1" name="$2" script="$3" outname="${4:-$1-$2}" dur="${5:-}" rate="${6:-}"
  echo "$phase:$name" > "$MARK_FILE"
  log "  → $phase/$name"
  local args=(
    -e "IDS_FILE=$BENCH_DIR/seed/ids.json"
    -e "ORIGIN=$BENCH_BASE_URL"
    -e "BASE_URL=$BENCH_API"
    -e "SUMMARY_OUT=$RESULTS/scenarios/$outname.json"
  )
  if [[ -n "$rate" ]]; then
    args+=(-e "RATE=$rate")
  elif [[ -n "${RATE:-}" ]]; then
    args+=(-e "RATE=$RATE")
  fi
  if [[ -n "$dur" ]]; then
    args+=(-e "DURATION=$dur")
  elif [[ -n "${DURATION:-}" ]]; then
    args+=(-e "DURATION=$DURATION")
  fi
  [[ -n "${PRE_VUS:-}" ]] && args+=(-e "PRE_VUS=$PRE_VUS")
  [[ -n "${MAX_VUS:-}" ]] && args+=(-e "MAX_VUS=$MAX_VUS")
  ( cd "$BENCH_DIR/k6" && k6 run "${args[@]}" "scenarios/$script" ) >>"$RESULTS/logs/$phase-$name.log" 2>&1
}

# 预热：让进程内缓存与 PG 计划进入稳定态，结果不参与计分
warmup() {
  local name="$1" script="$2"
  run_k6 warmup "$name" "$script" "warmup-$name" "${WARMUP_DURATION:-5s}"
}

# fast_rate 高负载快速档的每场景到达率（可用环境变量覆盖）
fast_rate() {
  case "$1" in
    read-anon) echo "${FAST_RATE_READ_ANON:-2000}" ;;
    search)    echo "${FAST_RATE_SEARCH:-120}" ;;
    read-auth) echo "${FAST_RATE_READ_AUTH:-800}" ;;
    write)     echo "${FAST_RATE_WRITE:-200}" ;;
    media)     echo "${FAST_RATE_MEDIA:-100}" ;;
    mixed)     echo "${FAST_RATE_MIXED:-1200}" ;;
    *)         echo "100" ;;
  esac
}

SCENARIOS="read-anon:read-anon.js search:search.js read-auth:read-auth.js write:write.js media:media.js mixed:mixed.js"

if [[ "$PROFILE" == "smoke" ]]; then
  run_k6 smoke smoke smoke.js
elif [[ "$PROFILE" == "fast" ]]; then
  log "快速高负载档：每场景 ${FAST_DURATION:-20s}（预热 ${FAST_WARMUP:-5s}）"
  for pair in $SCENARIOS; do
    name="${pair%%:*}"; script="${pair##*:}"
    r="$(fast_rate "$name")"
    MAX_VUS=$(( r / 20 + 100 )) run_k6 warmup "$name" "$script" "warmup-$name" "${FAST_WARMUP:-5s}" "$r"
  done
  for pair in $SCENARIOS; do
    name="${pair%%:*}"; script="${pair##*:}"
    r="$(fast_rate "$name")"
    MAX_VUS=$(( r / 20 + 100 )) run_k6 warm "$name" "$script" "warm-$name" "${FAST_DURATION:-20s}" "$r"
  done
  echo "warm:sse" > "$MARK_FILE"
  log "  → warm/sse"
  "$BENCH_DIR/bin/bench-sse" -url "$BENCH_API/world/stream" \
    -connections "${SSE_CONNECTIONS:-300}" -duration "${SSE_DURATION:-20s}" \
    -out "$RESULTS/sse.json" >>"$RESULTS/logs/sse.log" 2>&1
elif [[ "$PROFILE" == "capacity" ]]; then
  log "容量阶梯测试（找 p95 拐点，不计入回归分）"
  for r in ${CAPACITY_RATES:-2000 5000 10000 20000}; do
    maxv=$(( r / 20 + 100 ))
    [[ $maxv -gt 2000 ]] && maxv=2000
    MAX_VUS=$maxv run_k6 capacity "rate-$r" rate-test.js "capacity-$r" "${CAPACITY_DURATION:-10s}" "$r"
  done
else
  if [[ ",$PHASES," == *,cold,* ]]; then
    log "冷跑阶段（每个场景前重启服务，清空进程内缓存）"
    for pair in $SCENARIOS; do
      name="${pair%%:*}"; script="${pair##*:}"
      bash "$BENCH_DIR/scripts/server.sh" restart >/dev/null
      run_k6 cold "$name" "$script"
    done
  fi
  if [[ ",$PHASES," == *,warm,* ]]; then
    log "预热阶段（填充缓存，不计分）"
    for pair in $SCENARIOS; do
      name="${pair%%:*}"; script="${pair##*:}"
      warmup "$name" "$script"
    done
    log "热跑阶段（不重启服务，计分）"
    for pair in $SCENARIOS; do
      name="${pair%%:*}"; script="${pair##*:}"
      run_k6 warm "$name" "$script"
    done
  fi

  echo "warm:sse" > "$MARK_FILE"
  log "  → warm/sse"
  "$BENCH_DIR/bin/bench-sse" -url "$BENCH_API/world/stream" \
    -connections "${SSE_CONNECTIONS:-200}" -duration "${SSE_DURATION:-30s}" \
    -out "$RESULTS/sse.json" >>"$RESULTS/logs/sse.log" 2>&1
  TOKEN="$(python3 -c 'import json,sys;print((json.load(open(sys.argv[1])).get("tokens") or [""])[0])' "$BENCH_DIR/seed/ids.json" 2>/dev/null || echo '')"
  if [[ -n "$TOKEN" ]]; then
    "$BENCH_DIR/bin/bench-sse" -url "$BENCH_API/messages/stream" -token "$TOKEN" \
      -connections "${SSE_MSG_CONNECTIONS:-50}" -duration "${SSE_MSG_DURATION:-15s}" \
      -out "$RESULTS/sse-messages.json" >>"$RESULTS/logs/sse.log" 2>&1 || true
  fi
fi

kill "$COLLECTOR_PID" 2>/dev/null || true
wait "$COLLECTOR_PID" 2>/dev/null || true
trap - EXIT

FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$RESULTS/run.json" "$FINISHED" <<'PY'
import json,sys
p=sys.argv[1]
d=json.load(open(p))
d['finished_at']=sys.argv[2]
json.dump(d,open(p,'w'),ensure_ascii=False,indent=2)
PY

"$BENCH_DIR/bin/bench-report" -results "$RESULTS" \
  -scenarios "$BENCH_DIR/config/scenarios.json" \
  -baseline-root "$BASELINE_ROOT"

# 基线归档（报告已对比旧基线，再把本次写入历史）
if [[ "$PROFILE" == "full" || "$PROFILE" == "fast" ]]; then
  BL_DIR="$BASELINE_ROOT/$FP_KEY/$SCALE-$PROFILE"
  mkdir -p "$BL_DIR"
  cp "$RESULTS/summary.json" "$BL_DIR/$RUN_ID.json"
  ls -1t "$BL_DIR"/*.json 2>/dev/null | tail -n +11 | xargs -r rm -f
  log "基线：$BL_DIR/$RUN_ID.json"
fi

log "完成：$RESULTS/report.md"
