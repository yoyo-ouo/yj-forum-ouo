#!/usr/bin/env bash
# ============================================================
# 基准测试公共函数库（路径 / 日志 / 环境加载 / 安全守卫 / 机器指纹）
# 使用：source "$(dirname "$0")/lib.sh"
# ============================================================
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUO_DIR="$(cd "$BENCH_DIR/.." && pwd)"
CONFIG_DIR="$BENCH_DIR/config"
ENV_FILE="${BENCH_ENV_FILE:-$CONFIG_DIR/bench.env}"
RESULTS_ROOT="$BENCH_DIR/results"
BASELINE_ROOT="$BENCH_DIR/baselines"
PID_FILE="$RESULTS_ROOT/bench-server.pid"
SERVER_LOG="${BENCH_SERVER_LOG:-$RESULTS_ROOT/bench-server.log}"

BENCH_DB_CONTAINER="ouo-postgres-bench"
BENCH_DB_PORT="5433"
BENCH_DB_NAME="yj_forum_bench"
BENCH_DB_PASSWORD="localdev123"
BENCH_BASE_URL="http://127.0.0.1:8091"
BENCH_API="$BENCH_BASE_URL/ov2/api"

log()  { printf '\033[36m[bench]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[bench]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[bench]\033[0m %s\n' "$*" >&2; exit 1; }

# load_env 加载 bench 专用环境变量（首次自动从样例复制）。
load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$CONFIG_DIR/bench.env.example" "$ENV_FILE"
    log "已生成 $ENV_FILE"
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

# guard_env 启动前的硬性安全守卫：绝不允许污染开发库或发真实邮件。
guard_env() {
  [[ "${APP_ENV:-}" != "prod" ]] || die "拒绝在 APP_ENV=prod 下运行基准测试"
  [[ "${SMTP_ENABLED:-}" == "false" ]] || die "SMTP_ENABLED 必须显式设为 false（未设置等于应用侧默认开启，拒绝执行）"
  local db="${DATABASE_URL##*/}"
  db="${db%%\?*}"
  [[ "$db" == *_bench ]] || die "DATABASE_URL 库名必须以 _bench 结尾（当前：$db）"
  local host port
  host="$(python3 -c 'import sys,urllib.parse as u;print(u.urlparse(sys.argv[1]).hostname or "")' "$DATABASE_URL" 2>/dev/null || true)"
  port="$(python3 -c 'import sys,urllib.parse as u;print(u.urlparse(sys.argv[1]).port or "")' "$DATABASE_URL" 2>/dev/null || true)"
  case "$host" in 127.0.0.1|localhost|::1) ;; *) die "DATABASE_URL 主机必须是 loopback（当前：${host:-空}）" ;; esac
  [[ "$port" == "$BENCH_DB_PORT" ]] || die "DATABASE_URL 端口必须是 $BENCH_DB_PORT（当前：${port:-空}）"
}

# require_cmd 检查命令是否存在。
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1${2:+（$2）}"
}

# ensure_assets 生成 k6 上传用的最小 JPEG（160 字节，不进仓库）。
BENCH_JPEG_B64='/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
ensure_assets() {
  mkdir -p "$BENCH_DIR/assets"
  if [[ ! -f "$BENCH_DIR/assets/bench.jpg" ]]; then
    printf '%s' "$BENCH_JPEG_B64" | base64 -d > "$BENCH_DIR/assets/bench.jpg"
  fi
}

# ensure_dirs 创建运行目录。
ensure_dirs() {
  mkdir -p "$RESULTS_ROOT" "$BASELINE_ROOT" \
           "${MEDIA_DIR:-/tmp/yj-bench/media}" \
           "${AVATAR_DIR:-/tmp/yj-bench/avatar}" \
           "${DATA_DIR:-/tmp/yj-bench/data}"
}

# json_escape 简单转义（CPU 型号等）。
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# fingerprint_json 输出机器/依赖指纹（用于判断基线是否可比）。
fingerprint_json() {
  local cpu cores mem pg k6ver gover
  cpu="$(awk -F: '/^model name/{gsub(/^ +/,"",$2);print $2;exit}' /proc/cpuinfo 2>/dev/null)"
  [[ -n "$cpu" ]] || cpu="$(lscpu 2>/dev/null | awk -F: '/Model name/{gsub(/^ +/,"",$2);print $2;exit}')"
  [[ -n "$cpu" ]] || cpu="$(uname -m)"
  cores="$(nproc 2>/dev/null || echo 0)"
  mem="$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
  pg="$(docker exec "$BENCH_DB_CONTAINER" psql -U postgres -tAc 'show server_version' 2>/dev/null | tr -d '[:space:]' || true)"
  k6ver="$(k6 version 2>/dev/null | awk '{print $2}' | tr -d 'v' || true)"
  gover="$(go version 2>/dev/null | awk '{print $3}' || true)"
  printf '{"cpu":"%s","cores":%s,"mem_mb":%s,"pg":"%s","k6":"%s","go":"%s"}' \
    "$(json_escape "$cpu")" "$cores" "$mem" "$(json_escape "$pg")" \
    "$(json_escape "$k6ver")" "$(json_escape "$gover")"
}

# fingerprint_key 指纹短哈希（基线目录名）。
fingerprint_key() { fingerprint_json | sha256sum | cut -c1-12; }

# port_in_use 检查端口是否被监听。
port_in_use() { ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN; }

# assert_dev_services_stopped 提醒开发服务会干扰跑分。
assert_dev_services_stopped() {
  local busy=()
  for p in 8080 8090 3200 5173; do
    port_in_use "$p" && busy+=("$p")
  done
  if (( ${#busy[@]} > 0 )); then
    warn "检测到开发服务端口被占用（${busy[*]}），同机压测会互相干扰。"
    warn "建议先执行 make stop；如确认忽略请设置 BENCH_IGNORE_DEV_SERVICES=1。"
    [[ "${BENCH_IGNORE_DEV_SERVICES:-0}" == "1" ]] || die "已阻止跑分：请先停止开发服务"
  fi
}
