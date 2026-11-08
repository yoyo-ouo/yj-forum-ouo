# 错误码与响应

## 统一失败

```json
{ "success": false, "message": "可读错误" }
```

兼容层部分端点使用 `{ok:false,error,message}`（admin 风格）；以具体模块文档为准。

## 状态码

| 状态 | 场景 |
|---|---|
| 400 | 参数/验证/ALTCHA/黑名单/内容超限 |
| 401 | 未登录/会话过期/密码错误 |
| 403 | CSRF/封禁/权限不足 |
| 404 | 资源不存在/私密媒体未授权/人机验证通道未开启（`CAPTCHA_DISABLED`） |
| 409 | 重复收藏/重复签到/唯一约束冲突 |
| 413 | 图片/请求体过大 |
| 426 | 旧 APP 版本过低（`VERSION_TOO_LOW`） |
| 429 | 限流/发言过快 |
| 500 | 服务器错误 |
| 502 | 上游（GitHub/一言/头像）失败 |
| 503 | 配置未就绪（如 PG 缺失）/ALTCHA 主密钥缺失（`CAPTCHA_UNAVAILABLE`） |

## 常见业务错误

| code/message | 说明 |
|---|---|
| `CAPTCHA_REQUIRED` | ALTCHA 未完成/无效，或 APP 通道签名错误/时间戳超窗/nonce 已消费（重放）/grant 无效 |
| `CAPTCHA_DISABLED` | 人机验证未开启（`ALTCHA_ENABLED=false`，或 `/captcha/app/*` 未配置 `ALTCHA_APP_SECRET`）；APP 应提示「人机验证暂不可用」而不是本地求解 |
| `CAPTCHA_UNAVAILABLE` | ALTCHA 已启用但主密钥缺失/挑战签发失败（fail-closed）；verify 侧异常同样拒绝，但返回 400 |
| `请求过于频繁，请稍后再试` | IP 限流（标准 challenge 60/分、verify 20/分；APP challenge 30/分、verify 12/分） |
| `邮箱异样` | 注册邮箱命中黑名单 |
| `发言太快，请稍后再试` | 世界/聊天 2 秒限流 |
| `图片最多 9 张` | 世界频道图片上限 |
| `世界频道不支持引用卡片` | 禁 `data-embed` |
| `VERSION_TOO_LOW` | 旧 APP 版本低于 min_version |
