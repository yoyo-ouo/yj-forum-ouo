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

迁移：`0032_character_sheets`（up/down 成对）；同时给 `users` 加 `character_prompt_seen_at` 并把存量用户回填为 `now()`，只有迁移后注册的新用户会看到一次性引导。

## 2. 端点

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/character-sheets/mine` | 登录 | 我的全部（含草稿与草稿内容） |
| GET | `/character-sheets/user/:userId` | 公开 | 某用户的设定；本人额外拿到草稿与 `prompt_seen` |
| GET | `/character-sheets/:id` | 可选 | 详情；未公开的仅作者本人可读 |
| POST | `/character-sheets` | 登录 | 新建空角色（草稿态） |
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
