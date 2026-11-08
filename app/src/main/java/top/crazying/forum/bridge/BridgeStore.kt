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

    fun init(context: Context) {
        appContext = context.applicationContext
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            appContext,
            SECURE_PREFS,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
        CookieStore.loadFromPrefs()
        SessionMigrator.migrate(appContext, prefs)
    }

    fun context(): Context = appContext
}
