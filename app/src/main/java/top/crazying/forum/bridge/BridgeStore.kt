package top.crazying.forum.bridge

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import top.crazying.forum.BuildConfig

object BridgeStore {
    private const val SECURE_PREFS = "forum_secure_v2"
    const val LEGACY_PREFS = "forum_prefs"

    private lateinit var appContext: Context
    lateinit var prefs: SharedPreferences
        private set

    val apiBaseUrl: String
        get() = BuildConfig.API_BASE_URL.trim().trimEnd('/')

    val altchaSecret: String
        get() = BuildConfig.ALTCHA_APP_SECRET.trim()

    /** 顶部安全区高度（dp），由 MainActivity 监听 WindowInsets 测量后写入 */
    @Volatile
    var safeTopDp: Float = 0f

    /** 底部安全区高度（dp），由 MainActivity 监听 WindowInsets 测量后写入 */
    @Volatile
    var safeBottomDp: Float = 0f

    /** 左侧安全区宽度（dp），横屏刘海/挖孔用 */
    @Volatile
    var safeLeftDp: Float = 0f

    /** 右侧安全区宽度（dp），横屏刘海/挖孔用 */
    @Volatile
    var safeRightDp: Float = 0f

    fun init(context: Context) {
        appContext = context.applicationContext
        // keystore 被系统清除/损坏时 EncryptedSharedPreferences.create 会抛异常；
        // 若在此崩溃，Application.onCreate 每次启动都失败 → APP 永久无法启动。
        // 兜底：删掉损坏的密文库重建一次；仍失败则退化为普通 SharedPreferences（仅丢失加密性，不丢启动）。
        prefs = runCatching { createEncryptedPrefs() }
            .recoverCatching {
                appContext.deleteSharedPreferences(SECURE_PREFS)
                createEncryptedPrefs()
            }
            .getOrElse {
                appContext.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
            }
        CookieStore.loadFromPrefs()
        SessionMigrator.migrate(appContext, prefs)
    }

    private fun createEncryptedPrefs(): SharedPreferences {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            appContext,
            SECURE_PREFS,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun context(): Context = appContext
}
