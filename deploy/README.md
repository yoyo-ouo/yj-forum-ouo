# 妖精论坛 v2 部署指南（自建服务器 · 裸机）

## 架构总览

```
Browser
  │ HTTPS
  ▼
Nginx (宝塔管理 80/443)
  ├── /api/*      → Go 后端  127.0.0.1:8080
  ├── /avatar/*   → Go 后端  127.0.0.1:8080
  └── 其余        → Next.js  127.0.0.1:3000
```

- **渲染层**：Next.js（standalone 产物，Node 直跑）
- **服务层**：Go（编译二进制，systemd 管理）
- **数据库**：开发 = 本机 Docker PGSQL；生产 = **用户提供的外部 PGSQL**（`DATABASE_URL`）

## 一、数据库准备

**开发（本机 Docker）**：
```bash
docker run -d --name ouo-postgres \
  -e POSTGRES_PASSWORD=localdev123 -e POSTGRES_DB=yj_forum \
  -p 5432:5432 postgres:18
docker exec ouo-postgres psql -U postgres -c "CREATE DATABASE yj_forum;"  # 若不存在
```

**生产（外部 PGSQL）**：无需容器，将连接串写入 `server/.env` 的 `DATABASE_URL`。
首次启动时 Go 自动执行 golang-migrate 创建全部表（12 张业务表 + sessions + 索引）。

## 二、后端部署（Go）

```bash
cd /opt/yj-forum/server
cp .env.example .env        # 编辑：DATABASE_URL / SECRET_KEY / SMTP_*
go build -o bin/yj-forum ./cmd/yj-forum
cp /opt/yj-forum/deploy/yj-forum.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now yj-forum
systemctl status yj-forum
```

## 三、前端部署（Next.js）

```bash
cd /opt/yj-forum/web
pnpm install
pnpm build                    # 产出 .next/standalone
# 复制 standalone 产物（含 public/.next 静态文件）
cp -r .next/standalone/* .next/standalone/../ 2>/dev/null || true
mkdir -p .next/standalone && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/

cp /opt/yj-forum/deploy/yj-web.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now yj-web
```

> Next.js standalone 部署说明：`pnpm build` 后 `.next/standalone/server.js` 为独立运行入口；
> 需将 `public/` 与 `.next/static/` 复制到 standalone 目录内（见上）。

## 四、Nginx 反代

1. 宝塔面板创建站点（域名绑定）。
2. 将 `deploy/nginx/yj-forum.conf` 内容合并入站点配置（注意替换 `server_name` 为实际域名）。
3. 宝塔内申请 SSL 证书，开启 HTTPS（注释段提供 443 示范）。

## 五、验证

```bash
# 健康检查
curl http://127.0.0.1:8080/api/v1/votes/version/stats
curl -I http://127.0.0.1:3000/
# 浏览器访问域名，完成注册 → 登录 → 发帖全流程
```

## 六、环境变量速查

| 变量 | 位置 | 说明 |
|---|---|---|
| `DATABASE_URL` | server/.env | 数据库连接串（开发=本机 Docker，生产=外部 PGSQL） |
| `SECRET_KEY` | server/.env | Session 签名密钥（生产必须强随机） |
| `SMTP_*` | server/.env | 邮件发送（注册验证码/重置密码/通知） |
| `CORS_ORIGINS` | server/.env | CORS 白名单（生产建议配置域名） |
| `AVATAR_DIR` | server/.env | 头像存储目录 |
| `PUBLIC_BASE_URL` | server/.env | 邮件中链接的站点地址 |
| `API_TARGET` | web/.env | 开发时 Next 代理的 Go 地址（生产由 Nginx 分发） |
| `PORT` | web/.env | Next.js 监听端口（默认 3000） |
