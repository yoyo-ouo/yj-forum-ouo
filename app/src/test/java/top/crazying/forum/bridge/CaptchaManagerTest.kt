package top.crazying.forum.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
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
}
