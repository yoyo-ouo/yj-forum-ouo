# 基准性能跑分（bench/）

`yj-forum-ouo` 的后端基准测试集：k6 施压 + 独立 PG 容器 + 服务端插桩，输出可对比的「跑分」与瓶颈归因。

## 快速开始

```bash
cd yj-forum-ouo

# 1) 首次：安装 k6、构建工具、创建基准库
make bench-setup

# 2) 生成数据集（small 最快，medium 接近真实体量）
make bench-seed SCALE=small

# 3) 跑分（冷跑 + 预热 + 热跑 + SSE + 报告）
make bench-run SCALE=small

# 4) 查看报告
cat bench/results/<run-id>/report.md
# 或直接打开 bench/results/<run-id>/report.html
```

> **跑前先停开发服务**：`cd /home/yoyo/yjlt && make stop`。k6、Go 服务、PG 同机争抢 CPU 会让绝对值失真（脚本检测到 8080/8090/3200/5173 占用会直接拒绝）。

## 为什么需要独立环境

| 问题 | 处理 |
|---|---|
| 开发库只有个位数帖子，压不出真实成本 | 独立容器 `ouo-postgres-bench:5433`，三档数据集（最大 20 万帖 / 200 万评论） |
| 进程内 LRU 30s/60s/120s，冷热差异巨大 | 冷跑（每次重启服务）+ 预热 + 热跑三阶段，**只有热跑计分** |
| 登录 10 次/5 分钟、上传 30 次/10 分钟按 IP 限流 | `BENCH_DEBUG=true` 时旁路限流（仅非生产生效） |
| 开发 `server/.env` 配了真实 SMTP | 基准服务用 `env -i` 只注入 `bench/config/bench.env`，且硬性要求 `SMTP_ENABLED=false` |
| 开发库不能被污染 | 库名必须以 `_bench` 结尾、端口必须 5433，双重守卫 |

## 目录结构

```
bench/
├── config/bench.env.example   # 基准服务端环境（绝不读取 server/.env）
├── config/scenarios.json      # 场景权重 / 评分参数
├── k6/scenarios/*.js          # 6 个计分场景 + smoke
├── k6/lib/*.js                # HTTP / 数据池 / 结果导出
├── seed/                      # 三档数据集生成器（Go + COPY）
├── sse/                       # SSE 连接压测工具
├── metrics/                   # Go/PG/进程 指标采集器
├── report/                    # 评分 + Markdown/JSON/HTML 报告
├── scripts/                   # setup/db/seed/server/run/report
├── baselines/<指纹>/<档位>/   # 历史基线（入库）
└── results/                   # 本次运行产物（忽略）
```

## 三种跑法（按时间预算选）

| PROFILE | 墙钟时长 | 适用 |
|---|---|---|
| `full` | ~11 分钟 | 冷跑 + 预热 + 热跑，正式回归基线（数值更稳） |
| `fast`（默认） | ~3 分钟 | 高负载短时长（read-anon 2000/s、mixed 1200/s），日常快速回归 |
| `capacity` | ~1 分钟 | 2000→20000 阶梯加压，找 p95 拐点 |
| `smoke` | ~5 秒 | 只验证接口与数据池可用 |

```bash
make bench-run SCALE=small PROFILE=fast
make bench-run SCALE=small PROFILE=capacity
```

> **噪声提示**：本机是共享桌面环境（同时跑着桌面、IDE、监控），相同 `fast` 跑分两次的 p95 差异可达 **18–22%**。`fast` 只适合看趋势与抓大退化；发布前的正式对比请用 `PROFILE=full`，并把 ±20% 以内视为噪声。
>
> 基线按 `<指纹>/<档位>-<跑法>/` 隔离，`small-fast` 与 `small-full` 不会互相比较。

> 本机（Ryzen 5 7500F，6C/12T，15 GB）实测：read-anon 2000/s 时 p95 0.8ms；阶梯 5000/s 仍 1.4ms，10000/s 实际只跑到 9149/s 且 p95 234ms（k6 自身开始丢迭代）。**拐点在 5000–9000 req/s**，再往上压需要多进程 k6 或独立压测机。

## 数据集三档

| 档位 | 用户 | 会馆 | 帖子 | 评论 | 世界消息 | 私信 | 通知 | 会话 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| small | 100 | 10 | 1,000 | 10,000 | 5,000 | 5,000 | 5,000 | 50 |
| medium | 1,000 | 50 | 20,000 | 200,000 | 50,000 | 50,000 | 50,000 | 300 |
| large | 10,000 | 200 | 200,000 | 2,000,000 | 200,000 | 200,000 | 200,000 | 1,000 |

- 固定随机种子（默认 42）→ 同档位数据集可复现。
- 评论按幂律分布：少数热帖数千评论，用于暴露评论列表/计数成本。
- 写入后 `VACUUM ANALYZE`，否则执行计划严重失真。
- 登录态直接预置 `sessions`，绕开 bcrypt 与 ALTCHA。

## 场景与权重

| 场景 | 脚本 | 默认到达率 | 权重 | 覆盖 |
|---|---|---:|---:|---|
| read-anon | `read-anon.js` | 300/s | 0.25 | feed、帖子列表/详情、评论、会馆、指南、文章 |
| search | `search.js` | 20/s | 0.15 | 帖子/用户/文章 `ILIKE` 搜索 |
| read-auth | `read-auth.js` | 120/s | 0.10 | 个人页、收藏、回复、共同关注 |
| write | `write.js` | 30/s | 0.10 | 发帖、评论、点赞、收藏 |
| media | `media.js` | 20/s | 0.05 | 上传 200KB 图片 + 读取 |
| mixed | `mixed.js` | 250/s | 0.30 | 按真实比例混合读写 |
| sse | `bench-sse` | 200 连接 | 0.05 | 世界频道 / 私信长连接 |

所有 k6 场景使用 `constant-arrival-rate`（open model），避免 closed model 的 coordinated omission。

## 评分口径

```
单场景指数 I = 100 × (基线 p95 / 本次 p95)
           钳制在 [10, 400]
综合分 = 10 × Π(I_s ^ w_s)   （Σw = 1，加权几何平均）
```

- 基线自身 = **1000 分**；分数 > 1000 表示整体变快。
- 任一计分场景错误率 > 1% → 本次结果标「无效」，不出假分。
- 只有**指纹一致**时才能纵向比较：指纹 = CPU 型号/核数/内存 + PG 版本 + Go + k6 + git SHA + 档位。
- **不能**拿这套分数和其他项目横向比较。

## 报告解读

`report.md` / `report.html` 包含：

1. **综合分**与是否有效；
2. **场景明细**：RPS / p50 / p95 / p99 / 错误率 / 丢弃迭代 / 指数 / 涨跌；
3. **冷跑 vs 热跑**：定位缓存收益；
4. **瓶颈归因**：连接池空等、缓存命中率、Go 堆/Goroutine、进程 CPU/内存、PG 缓存命中、Top SQL、顺序扫描。

几个常见信号：

- `dropped_iterations > 0` → 压测端（k6）自己没跟上，降低 RATE 或提高 MAX_VUS。
- `连接池空等次数` 持续上升 → `MaxConns=10` 已是瓶颈，先看 Top SQL 再谈扩容。
- `search` 指数暴跌 + Top SQL 出现 `ILIKE` 全表扫描 → 符合预期（全库无 trgm 索引），不是回归。

## 安全边界

- `BENCH_DEBUG=true` 且 `APP_ENV=dev` 才会挂载 `/debug/metrics`、`/debug/pprof` 并旁路 IP 限流；**默认拒绝**：除 `dev` 之外的任何 `APP_ENV`（含空值、`production`、大小写变体）都会强制关闭；
- 调试端点**只允许 loopback**（`127.0.0.1` / `::1`）访问，即使误把 `HOST` 改成 `0.0.0.0` 也不会泄露堆转储；
- `guard_env` 硬性拒绝：`APP_ENV!=dev`、`SMTP_ENABLED` 未显式设为 `false`、库名不以 `_bench` 结尾、数据库主机不是 loopback、端口不是 5433；
- 基准 PG 容器只绑定 `127.0.0.1:5433`，不会暴露到局域网；
- 启动脚本会用 `env -i` 只注入 `bench.env`，并在最后强制覆盖 `SMTP_ENABLED=false`；
- `stop_server` 会校验 PID 对应的进程确实是 `yj-forum-bench`，避免 PID 复用误杀；
- 种子器会 `TRUNCATE` 所有业务表——只对 loopback 上的 `_bench` 库生效，勿指向开发库；
- 基线只在「指纹 + 档位 + 跑法 + 配置哈希」四项完全一致时才参与对比，缺一项即判为不可比。

## 已知限制

- PG 共享缓存无法真正冷启，冷跑只代表「应用进程内缓存为空」。
- 同机压测会互相争抢资源，绝对值只用于本机纵向对比。
- 媒体场景固定走本地 `MEDIA_DIR`（`S3_ENABLED=false`），与线上 S3 路径不同。
- 写场景会真实写入基准库，长时间跑会让数据集偏离初始分布。

## 常用命令

```bash
make bench-setup                 # 安装 k6 + 构建工具 + 建库
make bench-db                    # 启动/确保基准库容器
make bench-seed SCALE=medium     # 重建数据集（会清空基准库）
make bench-server                # 仅启动基准服务端 :8091
make bench-run SCALE=small       # 一键跑分
make bench-report                # 重新生成最近一次报告
make bench-down                  # 停服务与容器

# 临时缩短/放大场景（调试用）
SCALE=small PHASES=warm DURATION=15s RATE=50 bash bench/scripts/run.sh
```
