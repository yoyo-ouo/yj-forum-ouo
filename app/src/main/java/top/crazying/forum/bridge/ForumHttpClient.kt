package top.crazying.forum.bridge

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import top.crazying.forum.BuildConfig
import java.io.File
import java.util.concurrent.TimeUnit

class ApiResponse(
    val status: Int,
    val data: Any?,
    val text: String,
) {
    val ok: Boolean get() = status in 200..299

    fun code(): String = (data as? JSONObject)?.optString("code").orEmpty()

    fun toJs(): com.getcapacitor.JSObject = com.getcapacitor.JSObject()
        .put("status", status)
        .put("ok", ok)
        .put("data", JsonUtil.toJs(data))
        .put("text", text)
}

class ForumHttpClient {
    val okHttp: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(CookieStore)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .writeTimeout(35, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    val captcha = CaptchaManager(this)

    private val base: HttpUrl = BridgeStore.apiBaseUrl.toHttpUrl()

    private val origin: String by lazy {
        val defaultPort = if (base.scheme == "https") 443 else 80
        val portPart = if (base.port == defaultPort) "" else ":${base.port}"
        "${base.scheme}://${base.host}$portPart"
    }

    fun urlFor(path: String, query: Map<String, String> = emptyMap()): HttpUrl {
        val builder = if (path.startsWith("http://") || path.startsWith("https://")) {
            path.toHttpUrl().newBuilder()
        } else {
            base.newBuilder().addPathSegments("ov2/api").addPathSegments(path.trimStart('/'))
        }
        query.forEach { (key, value) -> builder.addQueryParameter(key, value) }
        return builder.build()
    }

    fun request(
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        body: JSONObject? = null,
        timeoutMs: Long = 0L,
        injectGrant: Boolean = true,
    ): ApiResponse {
        val payload = body?.let { JSONObject(it.toString()) }
        if (injectGrant && requiresGrant(path) && payload != null && !payload.has("grant") && !payload.has("altcha")) {
            captcha.ensureGrant()?.let { payload.put("grant", it) }
        }
        return execute(
            method = method,
            url = urlFor(path, query),
            body = payload,
            timeoutMs = timeoutMs,
        )
    }

    fun raw(
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        body: JSONObject? = null,
    ): ApiResponse = request(method, path, query, body, injectGrant = false)

    fun uploadImage(filePath: String, scene: String = "post_image"): ApiResponse {
        val file = File(filePath)
        require(file.exists()) { "文件不存在" }
        val mime = when (file.extension.lowercase()) {
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            else -> "image/jpeg"
        }
        val multipart = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", file.name, file.asRequestBody(mime.toMediaTypeOrNull()))
            .build()
        val request = baseRequest(urlFor("/media/images", mapOf("scene" to scene)))
            .post(multipart)
            .build()
        return executeRequest(request)
    }

    fun originHeader(): String = origin

    fun sseUrl(channel: String, lastId: String? = null): HttpUrl {
        val path = if (channel == "messages") "/messages/stream" else "/world/stream"
        val query = if (lastId.isNullOrBlank()) emptyMap() else mapOf("last_id" to lastId)
        return urlFor(path, query)
    }

    fun commonHeaders(): Map<String, String> = mapOf(
        "Origin" to origin,
        "Referer" to "$origin/",
        "User-Agent" to "CrForum-Android/${BuildConfig.APP_VERSION}",
        "Accept" to "text/event-stream",
    )

    fun absoluteGet(url: String, headers: Map<String, String> = emptyMap()): ApiResponse {
        val builder = Request.Builder()
            .url(url)
            .header("User-Agent", "CrForum-Android/${BuildConfig.APP_VERSION}")
            .header("Accept", "application/vnd.github+json")
        headers.forEach { (key, value) -> builder.header(key, value) }
        return executeRequest(builder.get().build())
    }

    private fun baseRequest(url: HttpUrl): Request.Builder = Request.Builder()
        .url(url)
        .header("Origin", origin)
        .header("Referer", "$origin/")
        .header("User-Agent", "CrForum-Android/${BuildConfig.APP_VERSION}")
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "zh-CN,zh;q=0.9")

    private fun execute(method: String, url: HttpUrl, body: JSONObject?, timeoutMs: Long): ApiResponse {
        val upper = method.uppercase()
        val requestBody = body?.toString()?.toRequestBody(JSON)
        val builder = baseRequest(url)
        when (upper) {
            "GET" -> builder.get()
            "HEAD" -> builder.head()
            "DELETE" -> builder.delete(requestBody)
            "PATCH" -> builder.patch(requestBody ?: "{}".toRequestBody(JSON))
            "PUT" -> builder.put(requestBody ?: "{}".toRequestBody(JSON))
            else -> builder.post(requestBody ?: "{}".toRequestBody(JSON))
        }
        val client = if (timeoutMs > 0) {
            okHttp.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build()
        } else {
            okHttp
        }
        return client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val parsed = JsonUtil.parse(text)
            if (response.code == 401) CookieStore.clear()
            ApiResponse(response.code, parsed, text)
        }
    }

    private fun executeRequest(request: Request): ApiResponse {
        return okHttp.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val parsed = JsonUtil.parse(text)
            if (response.code == 401) CookieStore.clear()
            ApiResponse(response.code, parsed, text)
        }
    }

    private fun requiresGrant(path: String): Boolean {
        val clean = path.substringBefore('?')
        return clean == "/auth/login" ||
            clean == "/auth/register" ||
            clean == "/auth/register/code" ||
            clean == "/auth/password/reset/link" ||
            clean == "/auth/password/reset/confirm" ||
            clean == "/reports/bug" ||
            Regex("^/posts/[^/]+/comments$").matches(clean)
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
