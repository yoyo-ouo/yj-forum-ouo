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

- `GET /captcha/config` → `{success,enabled,app_enabled,algorithm,cost}`
- `GET /captcha/challenge` → 官方 Challenge JSON（未启用 404）
- `POST /captcha/verify` body `{altcha}` → `{success,grant,expires_in:300}`

### APP 专用零 PoW 通道（Android）

服务端配置 `ALTCHA_APP_SECRET` 后开启；未配置时两个端点一律 404 `CAPTCHA_DISABLED`，客户端回退上面的 ALTCHA 求解。

- `GET /captcha/app/challenge` → `{success,challenge,timestamp,expires_in:120}`（`challenge` 为 32 位 hex 随机 nonce，`timestamp` 为服务端 Unix 秒）
- `POST /captcha/app/verify` body `{challenge,timestamp,signature}` → `{success,grant,expires_in:300}`
  - `signature = hex(HMAC-SHA256(ALTCHA_APP_SECRET, "app-captcha:v1:<challenge>:<timestamp>"))`
  - 时间戳容忍 ±5 分钟；nonce 一次性（复用 `altcha_used`，key 前缀 `app:`），重放一律 400 `CAPTCHA_REQUIRED`
  - 签发的 grant 与 ALTCHA 通道完全一致（5 分钟、绑定 IP），后续业务请求照常带 `grant`
- 限流：challenge 30 次/分钟/IP，verify 12 次/分钟/IP；挑战响应带 `Cache-Control: no-store`
- `expires_in` 是一次性 nonce 在 `altcha_used` 里的保留时长；签名时间戳实际容忍 ±5 分钟（为手机时钟漂移，两者语义不同）
- 安全边界：密钥内嵌 APK，可被逆向提取——该通道用于**把手机从千万级 PBKDF2 里解放出来**，不承诺强设备证明；真正的防线是 IP 限流 + 账号权限 + 内容风控

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
