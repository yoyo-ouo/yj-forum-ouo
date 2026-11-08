package top.crazying.forum.bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File

@CapacitorPlugin(name = "ForumMedia")
class ForumMediaPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client by lazy { ForumHttpClient() }
    private var pendingPhoto: File? = null

    @PluginMethod
    fun pickImage(call: PluginCall) {
        when (call.getString("source", "gallery")) {
            "camera" -> takePhoto(call)
            else -> pickGallery(call)
        }
    }

    private fun pickGallery(call: PluginCall) {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Intent(MediaStore.ACTION_PICK_IMAGES).apply { type = "image/*" }
        } else {
            Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "image/*"
                addCategory(Intent.CATEGORY_OPENABLE)
            }
        }
        startActivityForResult(call, intent, "handleGallery")
    }

    private fun takePhoto(call: PluginCall) {
        val dir = File(context.cacheDir, "media").apply { mkdirs() }
        val file = File(dir, "photo_${System.currentTimeMillis()}.jpg")
        pendingPhoto = file
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "handleCamera")
    }

    @ActivityCallback
    private fun handleGallery(call: PluginCall?, result: ActivityResult?) {
        if (result == null || result.resultCode != Activity.RESULT_OK) {
            call?.reject("已取消选择")
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            call?.reject("没有拿到图片")
            return
        }
        runCatching { copyToCache(uri) }
            .onSuccess { call?.resolve(it) }
            .onFailure { call?.reject(it.message ?: "读取图片失败") }
    }

    @ActivityCallback
    private fun handleCamera(call: PluginCall?, result: ActivityResult?) {
        val file = pendingPhoto
        pendingPhoto = null
        if (result == null || result.resultCode != Activity.RESULT_OK || file == null || !file.exists()) {
            call?.reject("已取消拍照")
            return
        }
        call?.resolve(
            JSObject()
                .put("path", file.absolutePath)
                .put("name", file.name)
                .put("mime", "image/jpeg"),
        )
    }

    @PluginMethod
    fun uploadImage(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        val scene = call.getString("scene", "post_image") ?: "post_image"
        scope.launch {
            runCatching {
                val response = client.uploadImage(path, scene)
                resolveOnUi(call, response.toJs())
            }.onFailure { rejectOnUi(call, it.message ?: "上传失败") }
        }
    }

    private fun copyToCache(uri: Uri): JSObject {
        val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
        val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "jpg"
        val dir = File(context.cacheDir, "media").apply { mkdirs() }
        val file = File(dir, "img_${System.currentTimeMillis()}.$ext")
        context.contentResolver.openInputStream(uri)?.use { input ->
            file.outputStream().use { output -> input.copyTo(output) }
        } ?: error("无法读取图片")
        return JSObject()
            .put("path", file.absolutePath)
            .put("name", file.name)
            .put("mime", mime)
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
