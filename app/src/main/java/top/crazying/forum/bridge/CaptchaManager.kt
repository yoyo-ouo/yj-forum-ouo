package top.crazying.forum.bridge

import org.json.JSONObject
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class CaptchaManager(private val http: ForumHttpClient) {
    private val lock = Any()
    private var grant: String? = null
    private var expiresAt: Long = 0L

    @Volatile
    var disabled: Boolean = false
        private set

    fun ensureGrant(force: Boolean = false): String? {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            if (!force && !grant.isNullOrBlank() && now < expiresAt) return grant

            val secret = BridgeStore.altchaSecret
            if (secret.isBlank()) return null

            if (disabled) return null

            val challengeResponse = http.raw("GET", "/captcha/app/challenge")
            if (challengeResponse.status == 404) {
                disabled = true
                return null
            }
            if (!challengeResponse.ok) return null
            val challenge = challengeResponse.data as? JSONObject ?: return null
            val nonce = challenge.optString("challenge")
            val timestamp = challenge.optLong("timestamp", 0L)
            if (nonce.isBlank() || timestamp <= 0L) return null

            val signature = hmacHex(secret, "app-captcha:v1:$nonce:$timestamp")
            val body = JSONObject()
                .put("challenge", nonce)
                .put("timestamp", timestamp)
                .put("signature", signature)
            val verify = http.raw("POST", "/captcha/app/verify", body = body)
            if (!verify.ok) return null
            val payload = verify.data as? JSONObject ?: return null
            val value = payload.optString("grant")
            if (value.isBlank()) return null
            val ttl = payload.optLong("expires_in", 300L).coerceAtLeast(60L)
            grant = value
            expiresAt = System.currentTimeMillis() + (ttl - 10L) * 1000L
            return value
        }
    }

    fun invalidate() {
        synchronized(lock) {
            grant = null
            expiresAt = 0L
        }
    }

    fun config(): JSONObject? {
        val response = http.raw("GET", "/captcha/config")
        return response.data as? JSONObject
    }

    companion object {
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

        private const val HEX = "0123456789abcdef"
    }
}
