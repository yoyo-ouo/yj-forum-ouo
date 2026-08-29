# 妖精论坛 ov2 API 文档（RESTful）

- **Base URL**: `https://<domain>/api/v1`
- **认证**: Session Cookie（`forum_session`，HttpOnly）或 `Authorization: Bearer`（预留）
- 响应 JSON：`{"success": true/false, ...}`；错误：`{"success": false, "message": "..."}`
- 状态码：200 成功 / 201 创建 / 400 参数错 / 401 未登录 / 403 无权限/封禁 / 404 不存在 / 429 限流 / 500 服务器错

## 认证 Auth

| 方法 | 路径 | 说明 | 登录 |
|---|---|---|---|
| POST | `/auth/register` | 注册（name/email/password/code） | 否（成功自动登录） |
| POST | `/auth/login` | 登录（name=邮箱或用户名/password/remember） | 否 |
| POST | `/auth/logout` | 登出 | 否 |
| POST | `/auth/register/code` | 发送注册验证码（email） | 否 |
| POST | `/auth/password/reset/code` | 发送重置验证码（email） | 否 |
| POST | `/auth/password/reset` | 验证码重置密码（email/code/password） | 否 |
| GET | `/auth/verify-token?token=&type=` | 邮箱验证 token 消费 | 否 |
| GET | `/auth/oauth/callback?app_id=` | 第三方登录（TheDoorOfBings） | 否 |

## 用户 Users

| 方法 | 路径 | 说明 | 登录 |
|---|---|---|---|
| GET | `/users/me` | 当前用户信息 | 否 |
| PATCH | `/users/me` | 修改资料（Name/gender/age/intro/password） | 是 |
| POST | `/users/me/avatar` | 上传头像（multipart: avatar） | 是 |
| GET | `/users/me/replies` | 我收到的回复 | 是 |
| POST | `/users/me/verify-email` | 发送邮箱验证码 | 是 |
| POST | `/users/me/verify-email/confirm` | 验证码确认邮箱 | 是 |
| GET | `/users/:id` | 用户主页（stats/follow_stats/is_following/is_self） | 否 |
| GET | `/users/:id/posts` | 用户帖子 | 否 |
| GET | `/users/:id/favorites` | 用户收藏 | 否 |
| POST | `/users/:id/follow` | 关注/取消 | 是 |
| GET | `/users/:id/following` | 关注列表 | 否 |
| GET | `/users/:id/followers` | 粉丝列表 | 否 |

## 帖子 Posts

| 方法 | 路径 | 说明 | 登录 |
|---|---|---|---|
| GET | `/posts?page=&page_size=&category=` | 帖子列表（缓存 30s） | 否 |
| GET | `/posts/random` | 随机 200 条 | 否 |
| GET | `/posts/:id` | 详情 + 评论 + liked/favorited（缓存 60s） | 否 |
| POST | `/posts` | 发帖（title/content/category） | 是 |
| POST | `/posts/:id/like` | 点赞/取消 | 是 |
| POST | `/posts/:id/favorite` | 收藏/取消 | 是 |
| POST | `/posts/:id/delete` | 删除（仅作者，软删） | 是 |
| POST | `/posts/:id/report` | 举报（reason/detail） | 是 |

## 评论 Comments

| 方法 | 路径 | 说明 | 登录 |
|---|---|---|---|
| GET | `/posts/:id/comments` | 评论列表（缓存 60s） | 否 |
| POST | `/posts/:id/comments` | 评论/回复（content/parent_id） | 是 |
| DELETE | `/comments/:id` | 删除评论（仅作者） | 是 |

## 世界频道 World

| 方法 | 路径 | 说明 | 登录 |
|---|---|---|---|
| GET | `/world/messages` | 最近 100 条（缓存 2s，5 分钟过期） | 否 |
| POST | `/world/messages` | 发送（content/parent_id，2s 限速） | 是 |

## 搜索 / 投票 / 杂项

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/search?k=&type=posts\|users\|both&page=` | 全文搜索（缓存 120s） |
| POST | `/votes/version` | 版本投票（choice=v1\|ov2，登录按账号/游客按 IP） |
| GET | `/votes/version/stats` | 投票统计 |
| POST | `/reports/bug` | Bug 举报（title/detail/steps/contact/page_url） |
| GET | `/easter-egg` | 随机彩蛋 |
| GET | `/hui-guan` | 会馆列表 |
| GET | `/avatar/:filename` | 头像文件（本地磁盘） |

## 限流规则（key: IP）

| 端点 | 阈值 |
|---|---|
| login | 10 次/300s |
| register / register code | 5 次/300s、3 次/300s |
| 发帖 | 10 次/60s |
| 评论 | 20 次/60s |
| 世界发送 | 5 次/60s |
| 投票 / Bug | 10 次/300s、5 次/300s |

## 数据模型（核心表）

- `users`：id(RL+时间戳)/name/avatar/email/password/gender/age/intro/vip/prefix/is_banned/email_verified
- `posts`：id(PS+时间戳)/user_id/title/content/category/likes/views/status
- `comments`：id(CM+时间戳)/post_id/user_id/content/parent_id/likes/status
- `world`：id/sender_id/sender_name/content/parent_id/created_at（5 分钟过期）
- `sessions`（ov2 新增）：token/user_id/expires_at
- 其余：post_likes、post_favorites、user_follows、verify_tokens、post_reports、bug_reports、verify_codes、version_votes
