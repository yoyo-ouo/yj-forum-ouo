# 下载客户端 / 版本检查

数据源：GitHub Releases `yoyo-ouo/yj-forum-nsh`（客户端安装包统一发布在该仓库；服务端 10 分钟缓存，可选 `GITHUB_TOKEN`，仓库可用 `GITHUB_RELEASES_REPO` 覆盖）。

NSH 一次构建多平台：**一个 Release 对应一个版本，tag 只放版本号**（`v1.2.0` / `1.2.0` / `v1.2.0-beta`），同一 Release 里同时上传各平台安装包；平台由**附件名**识别（文件名关键词优先，扩展名兜底）：

| 平台 | 识别规则 |
| --- | --- |
| android | 含 `android`，或 `.apk` / `.aab` |
| windows | 含 `windows`，或 `.exe` / `.msi`；无关键词的裸 `.zip` |
| linux | 含 `linux`，或 `.appimage` / `.deb` / `.rpm` / `.tar.gz` |
| macos | 含 `macos` / `darwin`，或 `.dmg` / `.pkg` |

无法识别的附件（`latest.json`、校验文件等）不参与平台列表；某平台在该版本没有安装包时，该平台不出现此版本。

GitHub 读不到时：`/downloads/*` 返回 502；`/api/app/releases` 与版本闸门返回空清单（无平台、无 min_versions，不展示发布、不强制升级）。不回退内置清单。

## 列表

`GET /ov2/api/downloads/releases?page=1&page_size=20&platform=windows`

条目：`{platform,version,channel,date,size,url,filename,sha256,notes,mandatory}`。

## 最新版

`GET /ov2/api/downloads/latest?platform=windows` → `{success,item}`。

## 版本检查

`GET /ov2/api/downloads/check?platform=windows&version=1.3.17`
```json
{ "success":true, "available":true, "mandatory":false, "current":"1.3.17", "latest":"1.3.18", "min_version":"1.3.18", "release":{...}, "download_url":"..." }
```

`min_versions` 约定：每个平台最新 stable Release 的版本；低于该版本旧 APP 的 `/api/*` 请求返回 426。

## 镜像

`GET /ov2/api/downloads/mirror/:platform/:filename`：仅允许清单中的 GitHub 资产；支持 Range/206；host 白名单 `github.com/githubusercontent.com/githubassets.com`。

## 公共镜像源

`GET /ov2/api/downloads/mirrors` → `{success,items:[{name,prefix}]}`。

- `prefix` 形如 `https://ghproxy.net/`，客户端拼 `prefix + GitHub 资产直链` 使用；仅用于加速，不改变内容。
- 列表由服务端 `DOWNLOAD_MIRRORS`（逗号分隔）配置，默认 `https://ghproxy.net/,https://gh-proxy.com/,https://ghfast.top/`。
