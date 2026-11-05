package top.crazying.forum.core

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import top.crazying.forum.MainActivity
import top.crazying.forum.R

/**
 * 消息通知（本地轮询版）。
 *
 * 服务端暂未接入 FCM，这里在进程存活时每 45 秒拉一次 `/messages/summary`：
 * 未读总数增加且 App 不在前台时发系统通知；点击通知直接进入消息中心。
 * 轮询间隔刻意大于 SSE 心跳，避免和 Web/Windows 端的实时推送形成双倍请求。
 */
object MessageNotifications {

    private const val CHANNEL_ID = "forum_messages"
    private const val NOTIFICATION_ID = 1001
    private const val INTERVAL_MS = 45_000L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var started = false

    @Volatile
    private var foreground = false

    fun start(context: Context) {
        if (started) return
        started = true
        ensureChannel(context.applicationContext)
        scope.launch {
            while (isActive) {
                delay(INTERVAL_MS)
                poll()
            }
        }
    }

    /** 由 Activity 生命周期回调维护，前台时不弹通知（避免用户正看着界面还被打扰）。 */
    fun setForeground(value: Boolean) {
        foreground = value
    }

    /**
     * 立即同步一次未读数（进入/离开消息中心时调用），只更新基线、不弹通知。
     * 这样用户读过消息后不会被旧计数再次提醒。
     */
    fun syncBaseline() {
        scope.launch { poll() }
    }

    private suspend fun poll() {
        if (!App.isLoggedIn) return
        val result = runCatching { App.api.messageSummary() }.getOrNull() ?: return
        if (!result.ok) return
        val total = result.int("likes") + result.int("comments") +
            result.int("system") + result.int("chat")
        val baseline = App.prefs.lastMessageTotal
        if (total > baseline && !foreground) {
            post(total)
        }
        App.messageUnread.value = total
        App.prefs.lastMessageTotal = total
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_messages),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.notification_channel_messages_desc)
        }
        manager.createNotificationChannel(channel)
    }

    private fun post(total: Int) {
        val context = AppContextHolder.context ?: return
        val manager = NotificationManagerCompat.from(context)
        // 通知开关关闭时不打扰用户；13+ 还需运行时通知权限，未授予直接跳过。
        if (!manager.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_OPEN_MESSAGES, true)
        }
        val pending = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_message)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.notification_new_messages, total))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build()
        runCatching {
            manager.notify(NOTIFICATION_ID, notification)
        }
    }
}

/**
 * Application.onCreate 时尽早保存 applicationContext，供通知构建使用。
 *
 * 只保存 applicationContext（与进程同生命周期），不存在 Activity 泄漏风险，
 * 因此无需 lint 的静态 Context 告警。
 */
@SuppressLint("StaticFieldLeak")
object AppContextHolder {
    @Volatile
    var context: Context? = null
}
