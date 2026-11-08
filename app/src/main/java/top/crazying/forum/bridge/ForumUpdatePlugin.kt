package top.crazying.forum.bridge

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
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
import org.json.JSONArray
import org.json.JSONObject
import top.crazying.forum.BuildConfig
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.math.max

@CapacitorPlugin(name = "ForumUpdate")
class ForumUpdatePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client by lazy { ForumHttpClient() }

    @PluginMethod
    fun check(call: PluginCall) {
        val current = call.getString("version") ?: BuildConfig.APP_VERSION
        scope.launch {
            runCatching {
                val response = client.request(
                    "GET",
                    "/downloads/check",
                    mapOf("platform" to "android", "version" to current),
                    injectGrant = false,
                )
                val data = response.data as? JSONObject
                if (response.ok && data != null) {
                    resolveOnUi(call, JsonUtil.toJsObject(data).put("source", "server"))
                    return@runCatching
                }
                val github = githubCheck(current)
                if (github != null) {
                    resolveOnUi(call, github)
                } else {
                    resolveOnUi(call, JSObject().put("available", false).put("current", current))
                }
            }.onFailure { rejectOnUi(call, it.message ?: "检查更新失败") }
        }
    }

    @PluginMethod
    fun download(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url required")
        val filename = call.getString("filename") ?: "update.apk"
        val expectedSize = call.getLong("size") ?: 0L
        val expectedSha = call.getString("sha256").orEmpty().trim().lowercase()
        val mirrors = call.getArray("mirrors")?.let { array ->
            (0 until array.length()).mapNotNull { array.optString(it)?.takeIf(String::isNotBlank) }
        }.orEmpty()

        scope.launch {
            runCatching {
                val safeName = filename.replace("..", "_").substringAfterLast('/').ifBlank { "update.apk" }
                val dir = File(context.cacheDir, "updates").apply { mkdirs() }
                val target = File(dir, safeName)
                if (target.exists()) target.delete()

                val candidates = buildList {
                    add(url)
                    if (isGitHub(url)) {
                        add("https://ghproxy.net/$url")
                        add("https://gh-proxy.com/$url")
                        add("https://ghfast.top/$url")
                    }
                    add("${BridgeStore.apiBaseUrl}/ov2/api/downloads/mirror/android/$safeName")
                    addAll(mirrors)
                }.distinct()

                var lastError = "下载失败"
                for (candidate in candidates) {
                    val ok = runCatching { downloadOne(candidate, target, expectedSize) }
                        .onFailure { lastError = it.message ?: lastError }
                        .getOrDefault(false)
                    if (!ok) {
                        target.delete()
                        continue
                    }
                    if (expectedSize > 0 && target.length() != expectedSize) {
                        lastError = "安装包大小不匹配"
                        target.delete()
                        continue
                    }
                    if (expectedSha.isNotBlank() && sha256(target) != expectedSha) {
                        lastError = "安装包校验失败"
                        target.delete()
                        continue
                    }
                    resolveOnUi(call, JSObject().put("path", target.absolutePath).put("url", candidate))
                    return@runCatching
                }
                rejectOnUi(call, lastError)
            }.onFailure { rejectOnUi(call, it.message ?: "下载失败") }
        }
    }

    @PluginMethod
    fun install(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        val file = File(path)
        if (!file.exists()) return call.reject("安装包不存在")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            openInstallSettingsInternal()
            resolveOnUi(call, JSObject().put("needsPermission", true))
            return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        resolveOnUi(call, JSObject().put("needsPermission", false))
    }

    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        openInstallSettingsInternal()
        resolveOnUi(call, JSObject().put("success", true))
    }

    private fun downloadOne(url: String, target: File, expectedSize: Long): Boolean {
        val request = okhttp3.Request.Builder()
            .url(url)
            .header("User-Agent", "CrForum-Android/${BuildConfig.APP_VERSION}")
            .build()
        client.okHttp.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return false
            val body = response.body ?: return false
            val total = if (expectedSize > 0) expectedSize else max(body.contentLength(), 0L)
            body.byteStream().use { input ->
                FileOutputStream(target).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var received = 0L
                    var lastEmit = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        received += read
                        val now = System.currentTimeMillis()
                        if (now - lastEmit > 220 || (total > 0 && received >= total)) {
                            lastEmit = now
                            val percent = if (total > 0) ((received * 100) / total).toInt() else -1
                            notifyProgress(received, total, percent, url)
                        }
                    }
                }
            }
            return true
        }
    }

    private fun githubCheck(current: String): JSObject? {
        val response = client.absoluteGet(
            "https://api.github.com/repos/yoyo-uo0/yj-forum-ouo/releases?per_page=30",
            mapOf("X-GitHub-Api-Version" to "2022-11-28"),
        )
        val array = response.data as? JSONArray ?: return null
        for (i in 0 until array.length()) {
            val release = array.optJSONObject(i) ?: continue
            if (release.optBoolean("draft")) continue
            val tag = release.optString("tag_name")
            if (!tag.startsWith("Android-V")) continue
            val version = tag.removePrefix("Android-V")
            if (VersionCompare.compare(version, current) <= 0) continue
            val assets = release.optJSONArray("assets") ?: continue
            for (j in 0 until assets.length()) {
                val asset = assets.optJSONObject(j) ?: continue
                val name = asset.optString("name")
                if (!name.endsWith(".apk", ignoreCase = true)) continue
                val digest = asset.optString("digest").removePrefix("sha256:")
                val notes = release.optString("body").lineSequence()
                    .map(String::trim)
                    .filter { it.isNotEmpty() }
                    .take(30)
                    .toList()
                val releaseObj = JSObject()
                    .put("version", version)
                    .put("url", asset.optString("browser_download_url"))
                    .put("filename", name)
                    .put("size", asset.optLong("size"))
                    .put("sha256", digest)
                    .put("notes", JSArray(notes))
                    .put("mandatory", false)
                return JSObject()
                    .put("available", true)
                    .put("current", current)
                    .put("latest", version)
                    .put("mandatory", false)
                    .put("release", releaseObj)
                    .put("source", "github")
            }
        }
        return null
    }

    private fun notifyProgress(received: Long, total: Long, percent: Int, url: String) {
        val payload = JSObject()
            .put("received", received)
            .put("total", total)
            .put("percent", percent)
            .put("url", url)
        runOnUi { notifyListeners("updateProgress", payload) }
    }

    private fun openInstallSettingsInternal() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(intent) }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }

    private fun isGitHub(url: String): Boolean =
        url.contains("github.com") || url.contains("githubusercontent.com")

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
