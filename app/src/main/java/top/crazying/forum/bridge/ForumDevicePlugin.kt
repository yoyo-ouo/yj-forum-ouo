package top.crazying.forum.bridge

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "ForumDevice")
class ForumDevicePlugin : Plugin() {
    @PluginMethod
    fun openExternal(call: PluginCall) {
        val raw = call.getString("url") ?: return call.reject("url required")
        val uri = Uri.parse(raw)
        if (uri.scheme != "http" && uri.scheme != "https") return call.reject("仅支持 http/https")
        val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
            .onSuccess { call.resolve(JSObject().put("success", true)) }
            .onFailure { call.reject(it.message ?: "无法打开链接") }
    }

    @PluginMethod
    fun share(call: PluginCall) {
        val text = call.getString("text").orEmpty()
        val url = call.getString("url").orEmpty()
        val payload = listOf(text, url).filter { it.isNotBlank() }.joinToString("\n")
        if (payload.isBlank()) return call.reject("没有可分享的内容")
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, payload)
        }
        val chooser = Intent.createChooser(intent, "分享").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
        call.resolve(JSObject().put("success", true))
    }

    @PluginMethod
    fun setStatusBar(call: PluginCall) {
        val color = call.getString("color", "#D8E6E4") ?: "#D8E6E4"
        val darkIcons = call.getBoolean("darkIcons", true) ?: true
        val activity = bridge.activity ?: return call.reject("activity unavailable")
        activity.runOnUiThread {
            runCatching {
                activity.window.statusBarColor = Color.parseColor(color)
                activity.window.navigationBarColor = Color.parseColor(color)
                WindowInsetsControllerCompat(activity.window, activity.window.decorView).apply {
                    isAppearanceLightStatusBars = darkIcons
                    isAppearanceLightNavigationBars = darkIcons
                }
            }
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun vibrate(call: PluginCall) {
        val ms = (call.getInt("duration", 12) ?: 12).coerceIn(1, 100)
        val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        if (vibrator != null && vibrator.hasVibrator()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(ms.toLong())
            }
        }
        call.resolve(JSObject().put("success", true))
    }
}
