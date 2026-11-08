package top.crazying.forum.bridge

import org.json.JSONObject
import java.io.IOException
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** 零 PoW 通道的失败原因；供 JS 侧诊断（见 [CaptchaManager.status]）。 */
enum class CaptchaError {
    DISABLED,
    APP_DISABLED,
    MISSING_SECRET,
    SECRET_MISMATCH,
    RATE_LIMITED,
    NETWORK,
    REJECTED,
}

/**
 * APP 专用零 PoW 验证状态机：一次 HMAC-SHA256 换 grant，全程不求解 PoW。
 *
 * 流程：GET /captcha/config（缓存 5 分钟）→ 开关/密钥判定 → GET /captcha/app/challenge
 * → 本地 HMAC → POST /captcha/app/verify → 缓存 grant 到 expires_in - 10s。
 * 任何一步失败都写入 [lastError]，JS 侧可用 ForumApi.getCaptchaStatus() 诊断；
 * 本类不提供标准 ALTCHA / PBKDF2 回退。
 */
class CaptchaManager(private val http: ForumHttpClient) {
    private val lock = Any()
    private var grant: String? = null
    private var expiresAt: Long = 0L
    private var configCache: JSONObject? = null
    private var configFetchedAt: Long = 0L

    @Volatile
    var lastError: CaptchaError? = null

    fun ensureGrant(force: Boolean = false): String? {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            if (!force && !grant.isNullOrBlank() && now < expiresAt) return grant

            val blocker = configError(loadConfigLocked(), BridgeStore.altchaSecret.isBlank())
            if (blocker != null) return fail(blocker)
            val secret = BridgeStore.altchaSecret

            val challengeResponse = rawSafe("GET", "/captcha/app/challenge")
                ?: return fail(CaptchaError.NETWORK)
            challengeError(challengeResponse.status)?.let { return fail(it) }
            val challenge = challengeResponse.data as? JSONObject ?: return fail(CaptchaError.REJECTED)
            val nonce = challenge.optString("challenge").trim()
            val timestamp = challenge.optLong("timestamp", 0L)
            if (nonce.isEmpty() || timestamp <= 0L) return fail(CaptchaError.REJECTED)

            val body = JSONObject()
                .put("challenge", nonce)
                .put("timestamp", timestamp)
                .put("signature", hmacHex(secret, "app-captcha:v1:$nonce:$timestamp"))
            val verify = rawSafe("POST", "/captcha/app/verify", body) ?: return fail(CaptchaError.NETWORK)
            verifyError(verify.status)?.let { return fail(it) }
            val payload = verify.data as? JSONObject ?: return fail(CaptchaError.REJECTED)
            val value = payload.optString("grant").trim()
            if (value.isEmpty()) return fail(CaptchaError.REJECTED)

            val ttl = payload.optLong("expires_in", DEFAULT_TTL_SECONDS).coerceAtLeast(MIN_TTL_SECONDS)
            grant = value
            expiresAt = System.currentTimeMillis() + (ttl - EXPIRY_GUARD_SECONDS) * 1000L
            lastError = null
            return value
        }
    }

    /** 清空缓存的 grant 与错误状态（不影响 5 分钟的 config 缓存）。 */
    fun invalidate() {
        synchronized(lock) {
            grant = null
            expiresAt = 0L
            lastError = null
        }
    }

    /** 诊断快照：{enabled, app_enabled, error}，error 为 [lastError] 名称或空串。 */
    fun status(): JSONObject {
        val snapshot = synchronized(lock) { loadConfigLocked() }
        return JSONObject()
            .put("enabled", snapshot?.optBoolean("enabled", false) ?: false)
            .put("app_enabled", snapshot?.optBoolean("app_enabled", false) ?: false)
            .put("client_secret_configured", BridgeStore.altchaSecret.isNotBlank())
            .put("error", lastError?.name.orEmpty())
    }

    /** 兼容旧桥方法：强制刷新并返回 /captcha/config。 */
    fun config(): JSONObject? = synchronized(lock) { loadConfigLocked(force = true) }

    private fun fail(error: CaptchaError): String? {
        lastError = error
        return null
    }

    private fun loadConfigLocked(force: Boolean = false): JSONObject? {
        val now = System.currentTimeMillis()
        val cached = configCache
        if (!force && cached != null && now - configFetchedAt < CONFIG_TTL_MS) return cached
        val response = rawSafe("GET", "/captcha/config") ?: return cached
        val fresh = response.data as? JSONObject
        if (!response.ok || fresh == null) return cached
        configCache = fresh
        configFetchedAt = now
        return fresh
    }

    /** 网络异常统一当作 NETWORK，不向上抛（诊断接口/登录都不应因验证码通道抖动而崩）。 */
    private fun rawSafe(method: String, path: String, body: JSONObject? = null): ApiResponse? =
        try {
            http.raw(method, path, body = body)
        } catch (_: IOException) {
            null
        }

    companion object {
        private const val CONFIG_TTL_MS = 5 * 60 * 1000L
        private const val DEFAULT_TTL_SECONDS = 300L
        private const val MIN_TTL_SECONDS = 60L
        private const val EXPIRY_GUARD_SECONDS = 10L
        private const val HEX = "0123456789abcdef"

        fun hmacHex(secret: String, message: String): String {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
            val bytes = mac.doFinal(message.toByteArray(Charsets.UTF_8))
            return buildString(bytes.size * 2) {
                bytes.forEach { byte ->
                    val value = byte.toInt() and 0xFF
                    append(HEX[value ushr 4])
                    append(HEX[value and 0x0F])
                }
            }
        }

        /** config → 是否可继续：null 表示可继续，否则为阻断原因。 */
        fun configError(config: JSONObject?, secretBlank: Boolean): CaptchaError? = when {
            config == null -> CaptchaError.NETWORK
            !config.optBoolean("enabled", false) -> CaptchaError.DISABLED
            !config.optBoolean("app_enabled", false) -> CaptchaError.APP_DISABLED
            secretBlank -> CaptchaError.MISSING_SECRET
            else -> null
        }

        /** /captcha/app/challenge 状态码映射：null 表示 2xx 成功。 */
        fun challengeError(status: Int): CaptchaError? = when (status) {
            in 200..299 -> null
            404 -> CaptchaError.APP_DISABLED
            429 -> CaptchaError.RATE_LIMITED
            else -> CaptchaError.NETWORK
        }

        /** /captcha/app/verify 状态码映射：null 表示 2xx 成功。 */
        fun verifyError(status: Int): CaptchaError? = when (status) {
            in 200..299 -> null
            400 -> CaptchaError.SECRET_MISMATCH
            429 -> CaptchaError.RATE_LIMITED
            else -> CaptchaError.NETWORK
        }
    }
}
