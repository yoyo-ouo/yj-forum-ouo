# 认证 / ALTCHA / 黑名单

## 登录

`POST /ov2/api/auth/login`
```json
{ "name": "用户名或邮箱", "password": "...", "remember": true, "altcha": "<base64>", "grant": "<可选>" }
```
成功：`{ "success": true, "id": "RL..." }`，并写 `forum_session`（HttpOnly）与 `user_id`。

## 注册

`POST /ov2/api/auth/register`
```json
{ "name": "...", "email": "...", "password": "至少8位含字母数字", "code": "6位邮箱码", "altcha": "<base64>" }
```
成功 201；邮箱黑名单命中 400 `邮箱异样`。

## 发注册码 / 忘记密码

- `POST /auth/register/code` body `{email, altcha|grant}`
- `POST /auth/password/reset/link` body `{email, altcha|grant}`
- `GET /auth/password/reset/validate?token=`
- `POST /auth/password/reset/confirm` body `{token,password,altcha|grant}`

## ALTCHA

标准通道（浏览器）：`GET /captcha/config` → `GET /captcha/challenge` → 客户端求解 → `POST /captcha/verify` 换 `grant`。

- `GET /captcha/config` → `{success,enabled,app_enabled,algorithm,cost}`
- `GET /captcha/challenge` → 官方 Challenge JSON（未启用 404 `CAPTCHA_DISABLED`；响应 `Cache-Control: no-store`）
- `POST /captcha/verify` body `{altcha}` → `{success,grant,expires_in:300}`；无效/已重放 400 `CAPTCHA_REQUIRED`
- 限流（按 IP）：challenge **60 次/分钟**，verify **20 次/分钟**；超限 429 `{success:false,message:"请求过于频繁，请稍后再试"}`

### APP 专用零 PoW 通道（Android）

服务端配置 `ALTCHA_APP_SECRET` 后开启：APP 只做一次 HMAC-SHA256，不做任何 PoW 求解。
**未配置时两个端点一律 404 `CAPTCHA_DISABLED`，APP 没有本地求解器，也不会回退标准 ALTCHA——客户端应提示「人机验证暂不可用」。**

所需环境变量：

| 变量 | 要求 |
|---|---|
| `ALTCHA_ENABLED` | `true`（否则 `/captcha/*` 与 `/captcha/app/*` 全部 404） |
| `ALTCHA_HMAC_KEY` | 签发 challenge / grant 的主密钥（必需，`ALTCHA_ENABLED=true` 时不能为空） |
| `ALTCHA_APP_SECRET` | APP 通道密钥，**≥32 字符**、与 `ALTCHA_HMAC_KEY` 不同，且必须与 APK 内置值一致（`openssl rand -hex 32`） |

端点（**协议冻结，不得新增 PoW 求解或低强度变体**）：

- `GET /captcha/app/challenge` → `{success,challenge,timestamp,expires_in:120}`（`challenge` 为 32 位 hex 随机 nonce，`timestamp` 为服务端 Unix 秒；响应 `Cache-Control: no-store`）
- `POST /captcha/app/verify` body `{challenge,timestamp,signature}` → `{success,grant,expires_in:300}`
  - `signature = hex(HMAC-SHA256(ALTCHA_APP_SECRET, "app-captcha:v1:<challenge>:<timestamp>"))`（签名域固定，不要改动）
  - 时间戳容忍 ±5 分钟；nonce 一次性（复用 `altcha_used`，key 前缀 `app:`），重放一律 400 `CAPTCHA_REQUIRED`
  - 签发的 grant 与标准通道完全一致（5 分钟、绑定 IP、同一 `ALTCHA_HMAC_KEY` 验签），后续业务请求照常带 `grant`
- 限流：challenge 30 次/分钟/IP，verify 12 次/分钟/IP；超限 429
- `expires_in` 是一次性 nonce 在 `altcha_used` 里的保留时长；签名时间戳实际容忍 ±5 分钟（为手机时钟漂移，两者语义不同）
- 安全边界：密钥内嵌 APK，可被逆向提取——该通道用于**把手机从千万级 PBKDF2 里解放出来**，不承诺强设备证明；真正的防线是 IP 限流 + 账号权限 + 内容风控

#### 零 PoW 流程（APP 侧）

1. `GET /captcha/app/challenge` 拿 `challenge` + `timestamp`；
2. 本地算一次 `hex(HMAC-SHA256(ALTCHA_APP_SECRET, "app-captcha:v1:<challenge>:<timestamp>"))`；
3. `POST /captcha/app/verify` 提交三元组，换 5 分钟 `grant`；
4. 业务请求（登录/评论等）带 `grant`，服务端 `VerifyRequest` 验签后放行。

#### 失败码

| 状态 | message | 场景 |
|---|---|---|
| 404 | `CAPTCHA_DISABLED` | `ALTCHA_ENABLED=false`，或 `/captcha/app/*` 未配置 `ALTCHA_APP_SECRET` |
| 400 | `CAPTCHA_REQUIRED` | 签名错误、时间戳超窗、nonce 已消费（重放）、缺字段、grant 无效/过期 |
| 429 | `请求过于频繁，请稍后再试` | 端点限流 |
| 503 | `CAPTCHA_UNAVAILABLE` | 挑战签发失败（含主密钥 `ALTCHA_HMAC_KEY` 缺失）；verify 侧校验异常同样拒绝，但统一返回 400 |

> 服务端与 APK 的 `ALTCHA_APP_SECRET` 不一致的典型表现：challenge 返回 200，verify 返回 400 `CAPTCHA_REQUIRED`。部署顺序：**先服务端（代码 + env）后 APK**，旧 APK 不受影响。

## 账号安全

- 改密：`PATCH /users/me` body `{password,current_password}`；成功吊销其他会话并签发新会话。
- 邮箱换绑：`/users/me/email-change/*` 两阶段。
- 注销：`POST /users/me/delete`。

## 错误

| 状态 | message | 场景 |
|---|---|---|
| 400 | `CAPTCHA_REQUIRED` | ALTCHA 未完成/无效 |
| 400 | `邮箱异样` | 黑名单命中 |
| 400 | `验证码错误或已过期` | 邮箱码无效 |
| 401 | `用户名或密码错误` | 登录失败 |
| 429 | `请求过于频繁` | 限流 |
