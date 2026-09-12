#!/usr/bin/env bash
# ============================================================
# 确保本机 Docker 守护进程可用（开发环境专用）
# - 已就绪：直接返回
# - 未就绪：按顺序尝试自动启动：
#     1) systemd 用户服务 docker-desktop（官方推荐；引擎由 systemd 托管，
#        与 GUI 界面解耦，界面崩溃不影响守护进程）
#     2) Docker Desktop CLI（docker desktop start）
#     3) 原生 docker.service（非 Desktop 安装场景）
#   并等待其就绪（默认最长 180s，可用环境变量 DOCKER_START_TIMEOUT 调整）
# 用法：bash deploy/docker-ensure.sh [超时秒数]
# 退出码：0 = Docker 可用；1 = 无法自动启动（附排查提示）
# ============================================================
set -u

TIMEOUT="${1:-${DOCKER_START_TIMEOUT:-180}}"

ready() { docker info >/dev/null 2>&1; }

context_name() { docker context show 2>/dev/null || echo "default"; }

if ready; then
  echo "Docker 已就绪（context: $(context_name)）"
  exit 0
fi

echo "Docker 守护进程未响应（context: $(context_name)），尝试自动启动…"

started=""

# ---- 方式 1：Docker Desktop 的 systemd 用户服务（推荐）----
if systemctl --user list-unit-files docker-desktop.service >/dev/null 2>&1; then
  echo "  → 方式 1：systemd 用户服务 docker-desktop"
  if systemctl --user start docker-desktop >/dev/null 2>&1; then
    started="systemd"
  fi
fi

# ---- 方式 2：Docker Desktop CLI ----
if [ -z "$started" ] && docker desktop version >/dev/null 2>&1; then
  echo "  → 方式 2：docker desktop start（首次启动需 1~2 分钟）"
  log_file="$(mktemp)"
  if docker desktop start -d >"$log_file" 2>&1; then
    started="cli"
  else
    echo "  [!] docker desktop start 未成功，最近输出："
    tail -n 3 "$log_file" | sed 's/^/      /'
  fi
  rm -f "$log_file"
fi

# ---- 方式 3：系统级 docker 服务（非 Desktop 安装）----
if [ -z "$started" ] && systemctl list-unit-files docker.service >/dev/null 2>&1; then
  echo "  → 方式 3：系统级 docker.service"
  if [ "$(id -u)" = "0" ]; then
    systemctl start docker >/dev/null 2>&1 && started="docker.service" || true
  else
    sudo -n systemctl start docker >/dev/null 2>&1 || sudo systemctl start docker >/dev/null 2>&1 && started="docker.service" || true
  fi
fi

if [ -z "$started" ]; then
  {
    echo "[!] 未检测到可用的 Docker 自动启动方式（Docker Desktop / docker.service 均不可用）。"
    echo "    请手动启动 Docker 后重试。"
  } >&2
  exit 1
fi


# ---- 等待守护进程就绪 ----
echo "等待 Docker 就绪（最长 ${TIMEOUT}s，可 Ctrl+C 中止）…"
elapsed=0
while [ "$elapsed" -lt "$TIMEOUT" ]; do
  if ready; then
    printf '\n'
    echo "✅ Docker 已就绪（约 ${elapsed}s，context: $(context_name)）"
    exit 0
  fi
  printf '.'
  sleep 1
  elapsed=$((elapsed + 1))
  [ $((elapsed % 30)) -eq 0 ] && printf ' [%ss]\n' "$elapsed"
done
printf '\n'

# ---- 超时诊断 ----
{
  echo "[!] 等待超时：Docker 守护进程仍不可用。"
  echo "    排查建议："
  echo "      • 查看状态：docker desktop status"
  echo "      • 查看日志：docker desktop logs"
  if systemctl --user list-unit-files docker-desktop.service >/dev/null 2>&1; then
    echo "      • 查看用户服务：systemctl --user status docker-desktop"
  fi
  echo "      • 手动打开 Docker Desktop 完成初始化后重试"
  if docker context inspect desktop-linux >/dev/null 2>&1; then
    echo "      • 确认 CLI context 指向正确端点：docker context use desktop-linux"
  fi
} >&2
exit 1
