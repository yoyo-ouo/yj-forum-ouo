# 妖精论坛 v2 技术架构

- **Date**: 2026-08-29
- **Status**: v2.0

## 总览

```
┌────────────────────────────────────────────────────┐
│                    Browser (客户端)                 │
└───────────────────────┬────────────────────────────┘
                        │ HTTPS
                        ▼
┌────────────────────────────────────────────────────┐
│                 Nginx (宝塔 80/443)                │
│   /api/* /avatar/* → Go :8080   其余 → Next.js    │
└──────────┬─────────────────────────┬──────────────┘
           │                         │
           ▼                         ▼
┌───────────────────┐       ┌─────────────────────┐
│  Next.js (:3000)  │       │   Go Gin (:8080)    │
│  渲染层            │       │  服务层             │
│  - 页面渲染（SSG壳+  │       │  - RESTful API      │
│    客户端组件）     │       │  - Session 认证      │
│  - 静态资源 public/│       │  - 业务逻辑/中间件    │
│  - apiFetch 代理    │       │  - 进程内 LRU 缓存   │
└───────────────────┘       └──────────┬──────────┘
                                        │ pgx
                                        ▼
                              ┌────────────────────┐
                              │ PostgreSQL          │
                              │ 开发: 本机 Docker   │
                              │ 生产: 外部 PGSQL    │
                              └────────────────────┘
```

## 职责划分

### Next.js（渲染层）
- **页面**：App Router，全站静态壳（SSG）+ 客户端组件；`output: 'standalone'` 支持裸机部署。
- **数据获取**：客户端 `lib/api.ts` 统一 `fetch('/api/v1/...')`，`credentials: 'include'` 携带会话 cookie。
- **静态资源**：全部本地化于 `public/assets/`（图片/字体/CSS/JS/Live2D/鼠标包）。
- **状态**：`lib/store.tsx`（主题/登录用户），主题 localStorage 持久化 + 时间段自动切换。
- **开发代理**：`next.config.ts` rewrites `/api/*` → Go（生产由 Nginx 分发）。

### Go（服务层）
- **框架**：Gin；数据库 pgxpool + golang-migrate；密码 bcrypt（兼容 werkzeug scrypt/pbkdf2 旧哈希）。
- **认证**：数据库 `sessions` 表 + HttpOnly cookie（`forum_session`，24h）+ 非 HttpOnly `user_id` cookie（30 天，前端乐观判断）。
- **缓存**：进程内 LRU+TTL（posts 30s / post_detail 60s / user_info 300s / world 2s / search 120s / comments 60s）。
- **中间件**：CORS 白名单 / CSRF（Origin+Referer）/ 限流（IP+维度）/ 安全响应头 / gzip。
- **邮件**：SMTP（net/smtp），异步 goroutine 发送（注册码/重置码/登录提醒/粉丝通知/评论提醒/Bug 通知）。
- **存储**：头像本地磁盘 `AVATAR_DIR`；彩蛋/会馆 JSON 由 `DATA_DIR` 路径读取。

## 通信方式
- **RESTful JSON**：`/api/v1/*`，HTTP 状态码语义化（200/201/400/401/403/404/429/500）。
- 错误体：`{"success": false, "message": "..."}`（部分端点 HTTP 状态码携带语义）。
- 会话：HttpOnly cookie 由 Go 下发，浏览器自动携带；Next.js 与 Go 同域（Nginx 统一或开发代理）。

## 数据流示例

**登录**：
```
POST /api/v1/auth/login → Go 校验(兼容旧哈希) → 写 sessions → Set-Cookie
→ Next.js store.refreshUser() → GET /users/me → Header 显示用户名
```

**发帖**：
```
POST /api/v1/posts（auth） → SafeHTML 净化 → INSERT → 失效列表缓存 → 异步粉丝通知
→ 客户端跳转 /post/{id} → GET /posts/{id} → 渲染详情+评论
```

**世界频道**：
```
GET /world/messages（缓存2s）→ 前端 3s 轮询 → POST /world/messages（2s 间隔限速）
```

## 安全设计
- **XSS**：所有用户内容经 `SafeHTML`（黑名单标签/事件属性/javascript: 协议移除）；前端 React 默认转义。
- **CSRF**：非 GET 请求必须携带同源 Origin/Referer（支持 X-Forwarded-Host 代理场景）。
- **认证**：Session cookie HttpOnly + SameSite=Lax + Secure(prod)；封禁账号拒绝登录。
- **限流**：登录 10/300s、注册 5/300s、发帖 10/60s、评论 20/60s、世界 5/60s、投票 10/300s。
- **头像**：仅 JPG/PNG/WebP；路径穿越防护；UUID 文件名。

## 与 legacy 的差异
| 项 | legacy (Flask) | v2 (Next.js + Go) |
|---|---|---|
| 前端交互 | 外部 CDN AfterBody.js | React 组件化重写 |
| 样式 | CDN main.css | 本地 main.css + Tailwind 基础设施 |
| 认证 | Flask-Login 签名 cookie | 数据库 sessions 表 |
| API | /api/* 混合风格 | /api/v1/* RESTful |
| 缓存 | 内存 LRU + Vercel Blob | 进程内 LRU（单实例） |
| 部署 | Vercel Serverless | 自建服务器裸机 + Nginx |
