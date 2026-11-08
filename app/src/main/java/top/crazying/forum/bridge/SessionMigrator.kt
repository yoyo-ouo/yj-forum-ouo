package top.crazying.forum.bridge

import android.content.Context
import android.content.SharedPreferences

object SessionMigrator {
    private const val FLAG = "migrated_v2"

    fun migrate(context: Context, prefs: SharedPreferences) {
        if (prefs.getBoolean(FLAG, false)) return
        val legacy = context.getSharedPreferences(BridgeStore.LEGACY_PREFS, Context.MODE_PRIVATE)

        legacy.getString("cookie_store", null)?.takeIf { it.isNotBlank() }?.let { CookieStore.importSerialized(it) }
        listOf("theme_pref", "year_mode", "privacy_agreed_version", "last_name").forEach { key ->
            legacy.getString(key, null)?.let { prefs.edit().putString(key, it).apply() }
        }

        prefs.edit().putBoolean(FLAG, true).apply()
        legacy.edit().remove("cookie_store").remove("user_json").apply()
    }
}
