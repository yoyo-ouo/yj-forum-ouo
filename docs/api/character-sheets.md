# 设定记录（角色设定卡）

> canonical base：`/ov2/api`。一人可建多个角色；编辑写草稿，点「完成并公开 / 发布新版本」才对外可见。

## 1. 数据模型

| 表 | 说明 |
|---|---|
| `character_sheets` | 已公开内容（`status`：0 草稿 / 1 已公开 / 2 管理员下架） |
| `character_sheet_drafts` | 一份未发布的 JSONB 编辑副本（发布时事务内摊平到子表并删除） |
| `character_sheet_abilities` | 能力（六大系 + 自由文本，最多 10 条） |
| `character_sheet_images` | 配图（最多 3 张，存媒体 ID） |
| `character_sheet_quotes` | 语录（最多 20 条，`is_active` 由管理员下架） |
| `character_sheet_likes` | 点赞去重表（`UNIQUE(sheet_id, user_id)`） |
| `character_batch_previews` | 批量预览凭证（绑定用户 + 原文 SHA-256 + 失效时间；不存角色数据） |

迁移：`0032_character_sheets`（up/down 成对）；同时给 `users` 加 `character_prompt_seen_at` 并把存量用户回填为 `now()`，只有迁移后注册的新用户会看到一次性引导。

## 2. 端点

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/character-sheets/mine` | 登录 | 我的全部（含草稿与草稿内容） |
| GET | `/character-sheets/user/:userId` | 公开 | 某用户的设定；本人额外拿到草稿与 `prompt_seen` |
| GET | `/character-sheets/:id` | 可选 | 详情；未公开的仅作者本人可读 |
| POST | `/character-sheets` | 登录 | 新建空角色（草稿态） |
| GET | `/character-sheets/quota` | 登录 | 当前用户角色配额 `{used,max,remaining}` |
| POST | `/character-sheets/batch/preview` | 登录 | 批量文本解析预览（不写角色数据） |
| POST | `/character-sheets/batch` | 登录 | 正式批量创建（草稿；需预览凭证） |
| PUT | `/character-sheets/:id/draft` | 登录 | 自动保存草稿（整份 JSONB） |
| POST | `/character-sheets/:id/publish` | 登录 | 发布 / 发布新版本 |
| DELETE | `/character-sheets/:id/draft` | 登录 | 放弃草稿（从未发布过的角色直接删除） |
| DELETE | `/character-sheets/:id` | 登录 | 删除角色 |
| POST | `/character-sheets/:id/like` | 登录 | 点赞 / 取消（不能赞自己） |
| GET | `/character-sheets/search?k=&page=&page_size=` | 公开 | 引用选择器；空 `k` 返回最新 |
| POST | `/character-sheets/prompt-seen` | 登录 | 标记注册引导已展示 |

## 3. 负载

草稿与发布共用同一结构：

```json
{
  "name": "白夜", "alias": "小灯", "title": "衔灯的", "gender": 1,
  "age": "三百余岁", "build": "修长", "species": "妖精·灯灵", "identity": "会馆执灯人",
  "description_html": "<p>…</p>",
  "avatar_media_id": "MD…", "image_media_ids": ["MD…"],
  "guild": { "mode": "none|existing|custom", "guild_id": 12, "custom_name": "" },
  "abilities": [{ "category": "御灵系", "detail": "灯影" }],
  "quotes": [{ "content": "灯不必亮，路自会让人看见。" }],
  "quotes_visible": false
}
```

校验（服务端）：名字/年龄/体态必填（发布时），性别 0/1/2，能力 1–10（发布时至少 1），图片 ≤3，语录 ≤20，描述 ≤64KB；`description_html` 走 `sanitize.SanitizeRichContent`。

## 3.1 用户角色配额

- 每位用户最多 **60** 个角色设定（`CharacterMaxPerUser`，`server/internal/database/character_sheets.go`）。
- 统计口径：`character_sheets` 中该用户的全部行，**草稿 / 已公开 / 管理员下架都计入**，与单个创建入口一致。
- 单个创建与批量创建都在数据库事务内 `SELECT … FROM users WHERE id = $1 FOR UPDATE` 后重新统计，保证同一用户的「配额检查 + 创建」串行化，并发请求不会突破 60。
- 额度不足返回 400 + `code=QUOTA_EXCEEDED`（批量可能附加结构化错误），不会部分创建。

## 3.2 批量添加语法

每行一个角色，空行忽略：

```text
角色标识符：属性标识符-属性值|属性标识符-属性值
```

- 角色标识符：单个英文字母；同批次内唯一；只用于定位/报错，不写入角色数据。
- 角色行分隔符：中文冒号 `：` 或英文冒号 `:`。
- 属性分隔符：`|`；属性名与值按第一个未转义的 `-` 分割。
- `ability` 的值按第一个 `:` / `：` 分裂为 `能力分类:能力内容`。
- 转义：`\|` → `|`，`\\` → `\`；其他反斜杠序列返回 `INVALID_ESCAPE`。
- 批量原文 ≤ 64 KB；单次最多 20 个角色；`description` 单行 ≤ 2000 字（纯文本，服务端先 HTML 转义再包 `<p>`）。

属性标识符（完整英文，与 `CharacterSheetPayload` 对应）：

| 标识符 | 字段 | 类型 | 重复 |
|---|---|---|---|
| `name` | name | string（≤24，必填） | 否 |
| `alias` | alias | string（≤24） | 否 |
| `title` | title | string（≤24） | 否 |
| `gender` | gender | integer（0/1/2） | 否 |
| `age` | age | string（≤32） | 否 |
| `build` | build | string（≤32） | 否 |
| `species` | species | string（≤32） | 否 |
| `identity` | identity | string（≤32） | 否 |
| `description` | description_html | string（纯文本） | 否 |
| `ability` | abilities | object（分类:内容，≤10 项，内容 ≤60） | 是 |
| `quote` | quotes | string（≤120，≤20 条） | 是 |
| `quotes_visible` | quotes_visible | boolean（`true`/`false`） | 否 |

不支持 `guild`（会馆须在创建后单独设置）与不存在的 `high`；未知属性不会被静默忽略。头像/角色图片不支持批量设置。

### 3.2.1 批量预览 `POST /character-sheets/batch/preview`

请求：

```json
{ "content": "A：name-白夜|age-20\nB：name-黑夜|age-21" }
```

成功（解析通过且配额足够）：

```json
{
  "success": true,
  "items": [
    { "identifier": "A", "line": 1, "payload": { "name": "白夜", "gender": 0, "guild": { "mode": "none" }, "abilities": [], "quotes": [] } }
  ],
  "count": 2,
  "quota": { "used": 55, "max": 60, "remaining": 5 },
  "within_quota": true,
  "token": "<64 位 hex>",
  "expires_at": "2026-11-22T05:19:33+08:00",
  "not_before": "2026-11-22T05:19:26+08:00"
}
```

- 解析失败：400 `{success:false, code:"PARSE_FAILED", message, errors:[…]}`；错误项含 `line`、`identifier`、`field`、`code`、`message`。
- 解析通过但配额不足：仍返回 200 + 完整 `items`/`quota`/`within_quota:false`，但 **`token` 为空**，前端不能进入确认流程。
- 预览只写 `character_batch_previews` 凭证行，**不创建/修改任何角色数据**，也不调用草稿保存。
- 凭证有效期 10 分钟，绑定当前用户 + 原文 SHA-256；原文修改后旧凭证不可用。

### 3.2.2 正式批量创建 `POST /character-sheets/batch`

请求：

```json
{ "content": "<原始文本>", "token": "<预览返回的 token>" }
```

服务端流程：校验登录 → 校验 token 格式 → **重新解析原文**（不信任前端解析结果）→ 事务内锁凭证行，校验用户、原文摘要、有效期、3 秒等待 → 幂等判断（已消费则回放）→ 锁用户行重查配额 → 批量插入 `character_sheets`（status=0）与 `character_sheet_drafts`（JSONB）→ 记录结果并提交。

成功：

```json
{
  "success": true,
  "items": [{ "id": "CS…", "name": "白夜", "identifier": "A" }],
  "count": 2,
  "quota": { "used": 57, "max": 60, "remaining": 3 },
  "replayed": false
}
```

错误码：

| HTTP | code | 说明 |
|---|---|---|
| 400 | `PARSE_FAILED` | 重新解析失败，`errors` 为完整错误列表 |
| 400 | `PREVIEW_INVALID` | 凭证不存在 / 不属于当前用户 / 与原文不匹配 |
| 400 | `PREVIEW_EXPIRED` | 凭证超过 10 分钟 |
| 400 | `PREVIEW_NOT_READY` | 未满确认等待 3 秒 |
| 400 | `QUOTA_EXCEEDED` | 事务内重查配额不足，整个批次回滚 |

原子性与幂等：整批在一个事务内完成，任意失败全部回滚，不会出现部分角色；同一凭证重复提交时 `replayed=true` 并原样返回首次结果。

### 3.2.3 配额 `GET /character-sheets/quota`

```json
{ "success": true, "quota": { "used": 55, "max": 60, "remaining": 5 } }
```

批量页面用它展示当前数量/上限/剩余；预览与提交响应中的 `quota` 同结构。

媒体：`POST /media/images` 的 `scene` 支持 `character_avatar` / `character_image`；草稿也会写 `media_references(owner_type=character_draft)`——引用是媒体回收的唯一判据（本项目没有「长期无引用自动清扫」任务），删除内容/注销账号时会据此把不再被引用的新媒体置为已删除。

## 4. 引用节点

```html
<div data-embed="character" data-id="CS…" [data-variant] [data-size] [data-align]></div>
```

`GET /embeds?characters=id1,id2`（每类 ≤30）返回：

```json
{ "characters": [{ "id": "CS…", "name": "白夜", "title": "衔灯的", "alias": "小灯",
  "avatar": "/ov2/api/media/MD…", "owner_id": "RL…", "owner_name": "…",
  "owner_avatar": "…", "abilities": ["御灵系","空间系"], "like_count": 3 }] }
```

## 5. 联动

- **会馆**：`guild_id` 命中的已公开角色会以「设定角色」出现在 `GET /guilds/:slug/members`（`kind=character`），并计入 `member_count`；不写入 `guild_members`（该表 `user_id` 为主键、一人一馆）。
- **彩蛋**：`GET /easter-egg` 的池子 = 静态彩蛋 + 全部已公开、勾选参与且未下架的语录，等概率；语录条目返回 `Kind="quote"`、`Name=角色名`、`Text=语录正文`（前端渲染为「语录 —— 角色名」）。
- **消息中心**：点赞写 `notifications(type='character_like')`，并计入「赞」未读数与点赞列表（`source=character_like`，游标前缀 `ch_`）。
- **管理端**：`/api/character-sheets*`、`/api/character-quotes*`，表未就绪时读接口降级为空列表。
