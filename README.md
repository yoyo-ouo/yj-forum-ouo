# 妖精论坛 Android 客户端 2.0

《罗小黑战记》同人论坛（yjlt.top）的 Android 客户端，非商业同人项目。

2.0 是一次彻底重构：旧的 Kotlin + Jetpack Compose 实现已全部删除，改为 **Capacitor 8 本地移动 SPA + Kotlin 原生桥**。UI 是打包进 APK 的 React 应用，Kotlin 负责网络、会话、零 PoW 验证、媒体上传、SSE 与自更新。

## 特性

- **底部四栏导航**：广场 / 世界 / 消息 / 我的，中间「+」发帖；进入即论坛广场。
- **完整二级页面**：帖子详情、评论编辑器、发帖、搜索、用户主页、会馆、角色设定、指南、反馈、账号安全、版本更新等。
- **原生桥直连 `/ov2/api`**：Cookie、`Origin`/`Referer`、multipart 上传、SSE 都由 Kotlin 统一处理，Web 层不直接出网。
- **APP 零 PoW**：登录与评论走 `/captcha/app/*`，一次 HMAC 换取 grant，不再在手机上跑 PBKDF2。
- **不中断更新**：包名、签名、`versionCode` 公式、`Android-V*` tag 与 APK 命名全部沿用 1.x；1.3.0 用户可覆盖安装 2.0.0。
- **自更新**：首启 + 前台每 5 分钟检查；提示可关闭；支持 GitHub 直连 / 加速镜像 / 站内反代三级回退，校验大小与 SHA-256。
- **Web 同源富文本**：正文/评论支持 HTML 与历史 Markdown 渲染、图片、引用卡片（用户/帖子/文章/角色，可点击跳转）；编辑器支持 H2/H3、粗/斜/下划线、列表、引用、代码块、行内代码、链接、分割线、清除格式、表情与图片上传。
- **主题**：日间 / 夜间 / 跟随系统；色板来自论坛 Web 的 `tokens.css`。
- **个人中心完整帖子**：列表分页 + 「展开全文」，不再只显示 20 条摘要。

## 架构

```text
Android WebView（https://localhost，Capacitor 8）
  └─ web/ 本地 SPA（Vite + React 19 + TypeScript）
       ├─ NavStack / TabBar / ThemeProvider
       ├─ screens：广场/详情/发帖/搜索/用户/会馆/世界/消息/我的/版本…
       └─ lib/native.ts  ← Capacitor JS Bridge
            ├─ ForumApi    HTTP / Cookie / grant / 设置
            ├─ ForumMedia  相册/相机 + 上传
            ├─ ForumSse    世界/消息 SSE
            ├─ ForumUpdate  检查/下载/安装
            └─ ForumDevice  分享/外链/状态栏/震动
                 └─ OkHttp → /ov2/api → yj-forum-ouo/server
```

## 目录

```text
yj-forum-android/
├── app/                     # Android 模块（根 Gradle 工程）
│   ├── build.gradle.kts     # 版本/签名/Java 21/syncWebAssets
│   └── src/main/
│       ├── java/top/crazying/forum/
│       │   ├── ForumApp.kt
│       │   ├── MainActivity.kt
│       │   └── bridge/      # Kotlin 原生桥
│       ├── assets/
│       │   ├── capacitor.config.json
│       │   └── public/      # 由 web/dist 同步（gitignore）
│       └── res/
├── web/                     # 本地移动 SPA（源码）
│   ├── src/lib/
│   ├── src/components/
│   ├── src/screens/
│   └── src/styles/
├── .github/workflows/       # CI / Release
└── README.md
```

## 环境要求

| 项 | 版本 |
|---|---|
| JDK | 21（本机 JBR 21） |
| Android SDK | compileSdk 36 / build-tools 36.0.0 |
| Node.js | 22+（本机 26.7 已实测） |
| pnpm | 11.x |
| Android Studio | Otter 2025.2.1+（可选） |

Capacitor 8.5.3 / AGP 8.13.2 / Gradle 8.14.5 / Kotlin 2.2.20 / minSdk 24 / targetSdk 36。

## 快速开始

```bash
# 1. 构建前端
cd web
pnpm install --frozen-lockfile
pnpm build

# 2. 构建 Debug APK（模拟器默认连 10.0.2.2:8090）
cd ..
JAVA_HOME=/home/yoyo/.jdks/jbr-21.0.11 \
  bash ./gradlew testDebugUnitTest assembleDebug

# 3. 安装
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Gradle 的 `syncWebAssets` 任务会自动把 `web/dist` 复制到 `app/src/main/assets/public`；如果 `web/dist/index.html` 不存在，构建会给出明确提示。

## 本地开发

### 连接本地 ouo

debug 构建默认 `API_BASE_URL=http://10.0.2.2:8090`（Android 模拟器访问宿主机）。也可以覆盖：

```bash
# 真机 / 局域网
bash ./gradlew assembleDebug -PapiBaseUrl=http://192.168.1.10:8090

# 或 adb reverse（真机 USB）
adb reverse tcp:8090 tcp:8090
```

启动 ouo：工作区根 `make dev-ouo`（或 `make dev` 起四个服务）。

### 零 PoW 密钥

debug 构建需要注入与本地 `server/.env` 一致的 `ALTCHA_APP_SECRET`：

```bash
bash ./gradlew assembleDebug -PaltchaAppSecret=<可见 ASCII，建议 openssl rand -hex 32>
```

未注入时登录/评论会显示「APP 验证通道未开启」诊断；release CI 缺该 secret 会直接失败。

### 浏览器里调 UI

```bash
cd web
pnpm dev   # http://localhost:5174
```

非原生环境会走 `fetch` 回退（仅开发用）；原生环境所有请求都走 Kotlin 桥。

## 测试

```bash
# 前端
cd web
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run

# Kotlin
cd ..
JAVA_HOME=/home/yoyo/.jdks/jbr-21.0.11 bash ./gradlew testDebugUnitTest
```

当前覆盖：HMAC 零 PoW 向量、版本比较、分类/摘要格式化、无限年换算。

## 版本与发布

- 版本号唯一真相源：`app/build.gradle.kts` 的 `appVersionName`；`versionCode = major*10000 + minor*100 + patch`。
- 当前：**2.0.0 / versionCode 20000**。
- 包名 `top.crazying.forum`、签名证书、`Android-V*` tag、APK 命名 `forum-android-<ver>.apk` 均沿用 1.x。
- CI Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`、`ALTCHA_APP_SECRET`。
- 发布流程：改版本 → `assembleRelease` 预演 → 推 `Android` 分支 → 打附注 tag：

```bash
git tag -a --cleanup=verbatim Android-V2.0.0 -F notes.txt
git push origin Android
git push origin Android-V2.0.0
```

工作流会校验 tag 在 `Android` 分支上、用 `-PexpectedVersion` 校验版本、apksigner 校验证书 SHA-256（`bab9ac49…aa4668`），并生成 Release。

## 自更新

- 检查：`GET /ov2/api/downloads/check?platform=android&version=<ver>`；失败回退 GitHub Releases。
- 触发：首启（隐私同意后）一次；前台每 5 分钟；后台暂停。
- 提示可关闭；同一版本本次启动不重复弹；服务端 `mandatory` 只标「重要更新」，仍可稍后。
- 下载回退：GitHub 直连 → `ghproxy.net` / `gh-proxy.com` / `ghfast.top` → 站内 `/downloads/mirror/android/<file>`。
- 校验：大小完全相等 + SHA-256 匹配；失败删包换线路。
- 安装：FileProvider + 系统安装器；首次需允许「安装未知应用」。

## 从 1.3.0 升级

- 包名与签名不变，`versionCode` 从 10300 → 20000，可直接覆盖安装。
- `SessionMigrator` 会读取旧 `forum_prefs` 的 `cookie_store` / 主题 / 年制 / 隐私版本并迁移到加密存储，尽量保持登录态。
- 若旧 Cookie 解析失败，会要求重新登录，不阻塞启动。

## 已知限制

- 角色设定为只读（创建/编辑在 Web 端）；账号注销、邮箱换绑引导到 Web 端。
- 世界频道输入仅纯文本；SSE 在后台会暂停，回前台重连。
- 发帖草稿暂未接入 `/posts/drafts`；定时发布用 `datetime-local`。
- 未接 FCM 推送；只有前台未读角标 + SSE。
- 移动 SPA 与论坛 Web 共用色板与视觉语言，但组件是两套；`web/src/styles/tokens.css` 是唯一色板源。

## 版本记录

| 版本 | 日期 | 说明 |
|---|---|---|
| 2.0.0 | 开发中 | 彻底重构为 Capacitor + Kotlin 原生桥；底部四栏、零 PoW、版本更新二级页、个人中心完整帖子 |
| [1.3.0](https://github.com/yoyo-uo0/yj-forum-ouo/releases/tag/Android-V1.3.0) | 2026-10-31 | 消息中心、通知、左侧抽屉、线性图标 |
| [1.2.0](https://github.com/yoyo-uo0/yj-forum-ouo/releases/tag/Android-V1.2.0) | 2026-10-18 | 迁移 `/ov2/api`、ALTCHA 零 PoW、自建富文本 |
| [1.1.0](https://github.com/yoyo-uo0/yj-forum-ouo/releases/tag/Android-V1.1.0) | 2026-10-25 | 全量迁移 `/ov2/api` |

## 许可与说明

本项目为《罗小黑战记》非商业同人作品，与版权方无隶属关系。客户端仅访问妖精论坛（yjlt.top）及其公开接口；请勿用于商业用途。
