package top.crazying.forum.bridge

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** 会话 Cookie 持久化：旧版本为明文 forum_prefs，2.0 起写入加密偏好。 */
object CookieStore : CookieJar {
    private const val KEY = "cookie_store_v2"
    private val lock = Any()
    private val cookies = mutableListOf<Cookie>()

    fun loadFromPrefs() {
        synchronized(lock) {
            cookies.clear()
            val raw = BridgeStore.prefs.getString(KEY, null) ?: return
            cookies.addAll(parse(raw))
        }
    }

    fun importSerialized(raw: String) {
        synchronized(lock) {
            cookies.clear()
            cookies.addAll(parse(raw))
            persistLocked()
        }
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        synchronized(lock) {
            for (cookie in cookies) {
                this.cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
                if (cookie.expiresAt > System.currentTimeMillis()) this.cookies.add(cookie)
            }
            persistLocked()
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            cookies.removeAll { it.expiresAt <= now }
            return cookies.filter { it.matches(url) }
        }
    }

    fun hasSession(): Boolean = synchronized(lock) {
        cookies.any { it.name == "forum_session" && it.expiresAt > System.currentTimeMillis() }
    }

    fun headerFor(url: HttpUrl): String? = loadForRequest(url)
        .joinToString("; ") { "${it.name}=${it.value}" }
        .takeIf { it.isNotBlank() }

    fun clear() {
        synchronized(lock) {
            cookies.clear()
            persistLocked()
        }
    }

    private fun persistLocked() {
        BridgeStore.prefs.edit().putString(KEY, serialize(cookies)).apply()
    }

    private fun serialize(list: List<Cookie>): String = list.joinToString("\n") { c ->
        listOf(
            c.name,
            c.value,
            c.domain,
            c.path,
            c.expiresAt.toString(),
            if (c.secure) "1" else "0",
        ).joinToString("\u0001")
    }

    private fun parse(raw: String): List<Cookie> = raw.lineSequence().mapNotNull { line ->
        val f = line.split("\u0001")
        if (f.size < 6) return@mapNotNull null
        runCatching {
            Cookie.Builder()
                .name(f[0])
                .value(f[1])
                .domain(f[2])
                .path(f[3])
                .expiresAt(f[4].toLong())
                .apply { if (f[5] == "1") secure() }
                .build()
        }.getOrNull()
    }.toList()
}
