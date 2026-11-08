package top.crazying.forum.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CaptchaManagerTest {
    private val secret = "devsecret0123456789abcdef0123456789"
    private val challenge = "a".repeat(32)

    @Test
    fun hmacMatchesServerVector() {
        val message = "app-captcha:v1:$challenge:1794116564"
        assertEquals(
            "7213c585a7a47134f61ee4e4ab9dfc9fe2fabf95cd60891a7605bc988668888a",
            CaptchaManager.hmacHex(secret, message),
        )
    }

    @Test
    fun hmacChangesWithTimestamp() {
        val a = CaptchaManager.hmacHex(secret, "app-captcha:v1:$challenge:1794116564")
        val b = CaptchaManager.hmacHex(secret, "app-captcha:v1:$challenge:1794116565")
        assertNotEquals(a, b)
        assertEquals(64, a.length)
    }

    @Test
    fun captchaErrorNamesAreStable() {
        assertEquals(
            listOf(
                "DISABLED",
                "APP_DISABLED",
                "MISSING_SECRET",
                "SECRET_MISMATCH",
                "RATE_LIMITED",
                "NETWORK",
                "REJECTED",
            ),
            CaptchaError.entries.map { it.name },
        )
    }

    @Test
    fun challengeStatusMapsToError() {
        assertNull(CaptchaManager.challengeError(200))
        assertEquals(CaptchaError.APP_DISABLED, CaptchaManager.challengeError(404))
        assertEquals(CaptchaError.RATE_LIMITED, CaptchaManager.challengeError(429))
        assertEquals(CaptchaError.NETWORK, CaptchaManager.challengeError(500))
        assertEquals(CaptchaError.NETWORK, CaptchaManager.challengeError(0))
    }

    @Test
    fun verifyStatusMapsToError() {
        assertNull(CaptchaManager.verifyError(200))
        assertEquals(CaptchaError.SECRET_MISMATCH, CaptchaManager.verifyError(400))
        assertEquals(CaptchaError.RATE_LIMITED, CaptchaManager.verifyError(429))
        assertEquals(CaptchaError.NETWORK, CaptchaManager.verifyError(404))
        assertEquals(CaptchaError.NETWORK, CaptchaManager.verifyError(503))
    }

    @Test
    fun configErrorWalksStateMachine() {
        val enabled = JSONObject().put("enabled", true).put("app_enabled", true)
        assertNull(CaptchaManager.configError(enabled, secretBlank = false))
        assertEquals(CaptchaError.NETWORK, CaptchaManager.configError(null, secretBlank = false))
        assertEquals(
            CaptchaError.DISABLED,
            CaptchaManager.configError(JSONObject().put("enabled", false).put("app_enabled", true), false),
        )
        assertEquals(
            CaptchaError.APP_DISABLED,
            CaptchaManager.configError(JSONObject().put("enabled", true).put("app_enabled", false), false),
        )
        assertEquals(CaptchaError.MISSING_SECRET, CaptchaManager.configError(enabled, secretBlank = true))
        // 未配置时按关闭处理，避免无谓请求。
        assertEquals(CaptchaError.DISABLED, CaptchaManager.configError(JSONObject(), false))
    }
}
