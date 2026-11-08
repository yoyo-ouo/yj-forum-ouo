package top.crazying.forum.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import top.crazying.forum.BuildConfig

@CapacitorPlugin(name = "ForumApi")
class ForumApiPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client by lazy { ForumHttpClient() }

    @PluginMethod
    fun request(call: PluginCall) {
        val method = call.getString("method", "GET") ?: "GET"
        val path = call.getString("path") ?: return call.reject("path required")
        val query = JsonUtil.toQuery(call.getObject("query"))
        val body = call.getObject("body")?.let { JSONObject(it.toString()) }
        val timeout = call.getInt("timeoutMs")?.toLong() ?: 0L
        scope.launch {
            runCatching {
                val response = client.request(method, path, query, body, timeout)
                notifyIfNeeded(response)
                resolveOnUi(call, response.toJs())
            }.onFailure { rejectOnUi(call, it.message ?: "网络请求失败") }
        }
    }

    @PluginMethod
    fun uploadImage(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        val scene = call.getString("scene", "post_image") ?: "post_image"
        scope.launch {
            runCatching {
                val response = client.uploadImage(path, scene)
                notifyIfNeeded(response)
                resolveOnUi(call, response.toJs())
            }.onFailure { rejectOnUi(call, it.message ?: "上传失败") }
        }
    }

    @PluginMethod
    fun captchaConfig(call: PluginCall) {
        scope.launch {
            runCatching {
                val config = client.captcha.config()
                resolveOnUi(call, JsonUtil.toJsObject(config ?: JSONObject()))
            }.onFailure { rejectOnUi(call, it.message ?: "验证码配置获取失败") }
        }
    }

    @PluginMethod
    fun getAppInfo(call: PluginCall) {
        resolveOnUi(
            call,
            JSObject()
                .put("versionName", BuildConfig.APP_VERSION)
                .put("versionCode", BuildConfig.VERSION_CODE)
                .put("packageName", context.packageName)
                .put("apiBaseUrl", BridgeStore.apiBaseUrl)
                .put("altchaConfigured", BridgeStore.altchaSecret.isNotBlank()),
        )
    }

    @PluginMethod
    fun getStartupState(call: PluginCall) {
        val prefs = BridgeStore.prefs
        resolveOnUi(
            call,
            JSObject()
                .put("hasSession", CookieStore.hasSession())
                .put("theme", prefs.getString("theme_pref", null))
                .put("yearMode", prefs.getString("year_mode", null))
                .put("privacyAgreedVersion", prefs.getString("privacy_agreed_version", null))
                .put("lastName", prefs.getString("last_name", null)),
        )
    }

    @PluginMethod
    fun saveSettings(call: PluginCall) {
        val editor = BridgeStore.prefs.edit()
        call.getString("theme")?.let { editor.putString("theme_pref", it) }
        call.getString("yearMode")?.let { editor.putString("year_mode", it) }
        call.getString("privacyAgreedVersion")?.let { editor.putString("privacy_agreed_version", it) }
        call.getString("lastName")?.let { editor.putString("last_name", it) }
        editor.apply()
        resolveOnUi(call, JSObject().put("success", true))
    }

    @PluginMethod
    fun clearSession(call: PluginCall) {
        CookieStore.clear()
        client.captcha.invalidate()
        resolveOnUi(call, JSObject().put("success", true))
    }

    private fun notifyIfNeeded(response: ApiResponse) {
        if (response.status == 401) {
            runOnUi { notifyListeners("sessionExpired", JSObject()) }
        }
        if (response.status == 426 || response.code() == "VERSION_TOO_LOW") {
            runOnUi { notifyListeners("versionTooLow", JSObject().put("status", response.status)) }
        }
    }

    private fun resolveOnUi(call: PluginCall, data: JSObject) {
        runOnUi { call.resolve(data) }
    }

    private fun rejectOnUi(call: PluginCall, message: String) {
        runOnUi { call.reject(message) }
    }

    private fun runOnUi(block: () -> Unit) {
        val activity = bridge.activity
        if (activity == null) block() else activity.runOnUiThread(block)
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }
}
