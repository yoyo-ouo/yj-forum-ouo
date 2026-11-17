#!/usr/bin/env bash
# ============================================================
# 基准服务端进程管理（go build + 独立环境启动 + 健康检查）
# 用法：bash bench/scripts/server.sh start|stop|restart|status
# 关键点：cwd = bench/，并用 env -i 只注入 bench.env，
#         因此绝不会加载 server/.env（真实 SMTP/开发库连接串）。
# ============================================================
set -euo pipefail
source "$(dirname "$0")/lib.sh"

BIN="$OUO_DIR/server/bin/yj-forum-bench"

build_server() {
  log "编译基准服务端二进制…"
  ( cd "$OUO_DIR/server" && go build -o "$BIN" ./cmd/yj-forum )
}

wait_health() {
  local i
  for i in $(seq 1 120); do
    if curl -fsS "$BENCH_BASE_URL/healthz" >/dev/null 2>&1; then
      log "基准服务端已就绪：$BENCH_BASE_URL"
      return 0
    fi
    if [[ -f "$PID_FILE" ]] && ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      warn "服务进程已退出，最近日志："
      tail -30 "$SERVER_LOG" >&2 || true
      die "启动失败"
    fi
    sleep 0.5
  done
  warn "健康检查超时，最近日志："
  tail -30 "$SERVER_LOG" >&2 || true
  die "启动超时"
}

stop_server() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || { rm -f "$PID_FILE"; return 0; }
    # 只杀确实是基准二进制的进程，避免 PID 复用误杀
    if ! tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "yj-forum-bench"; then
      warn "PID $pid 不是基准服务端，跳过"
      rm -f "$PID_FILE"
      return 0
    fi
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.2
      done
      if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; fi
      log "已停止基准服务端（pid=$pid）"
    fi
    rm -f "$PID_FILE"
  fi
}

start_server() {
  load_env
  guard_env
  ensure_dirs
  stop_server >/dev/null 2>&1 || true
  if port_in_use "$PORT"; then
    die "端口 $PORT 仍被占用（PID 文件丢失或旧实例未退出），请先：pkill -f yj-forum-bench"
  fi
  build_server

  local envs=() k v
  while IFS='=' read -r k v; do
    [[ -z "$k" || "$k" == \#* ]] && continue
    envs+=("$k=$v")
  done < "$ENV_FILE"
  # 守卫与注入同一真相源：最后一位覆盖前面的任何值
  envs+=("SMTP_ENABLED=false")

  : > "$SERVER_LOG"
	log "启动基准服务端（PORT=${PORT}，DB=${DATABASE_URL##*/}）…"
	(
		cd "$BENCH_DIR"
		# setsid + nohup：与当前终端解耦，避免工具会话结束时收到 SIGHUP 被杀
		setsid nohup env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp "${envs[@]}" "$BIN" \
			</dev/null >>"$SERVER_LOG" 2>&1 &
		local launched=$!
		sleep 0.3
		# setsid 可能 fork，用 pgrep 定位真实进程；拿不到则用 $!。
		local real
		real="$(pgrep -n -f "^$BIN" 2>/dev/null || true)"
		[[ -n "$real" ]] || real="$launched"
		echo "$real" > "$PID_FILE"
	)
  wait_health
}

case "${1:-start}" in
  start)   start_server ;;
  stop)    stop_server ;;
  restart) stop_server; start_server ;;
  status)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      log "运行中（pid=$(cat "$PID_FILE")）：$BENCH_BASE_URL"
    else
      log "未运行"
    fi
    ;;
  *) die "用法：$0 start|stop|restart|status" ;;
esac
