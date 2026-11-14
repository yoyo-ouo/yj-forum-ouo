# 下载客户端 / 版本检查

数据源：GitHub Releases `yoyo-ouo/yj-forum-nsh`（客户端安装包统一发布在该仓库；服务端 10 分钟缓存，可选 `GITHUB_TOKEN`，仓库可用 `GITHUB_RELEASES_REPO` 覆盖）。平台由 tag 前缀识别：`Windows-V*` / `Android-V*` / `Linux-V*` / `macOS-V*`。GitHub 读不到时：`/downloads/*` 返回 502；`/api/app/releases` 与版本闸门返回空清单（无平台、无 min_versions，不展示发布、不强制升级）。不回退内置清单。

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
