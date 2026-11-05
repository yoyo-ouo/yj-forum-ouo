package top.crazying.forum

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import top.crazying.forum.core.App
import top.crazying.forum.core.MessageNotifications
import top.crazying.forum.ui.ForumRoot

/**
 * 唯一 Activity：全部界面由 Compose 绘制，导航是自实现的单 Activity 回退栈（见 `ui/AppNav.kt`）。
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // targetSdk 35+ 系统强制 edge-to-edge，这里显式开启，让各页面自己处理 insets。
        enableEdgeToEdge()
        handleIntent(intent)
        requestNotificationPermission()
        setContent { ForumRoot() }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        MessageNotifications.setForeground(true)
    }

    override fun onPause() {
        MessageNotifications.setForeground(false)
        super.onPause()
    }

    /** 通知点击进入消息中心：把一次性事件交给 ForumRoot 消费。 */
    private fun handleIntent(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_OPEN_MESSAGES, false) == true) {
            App.openMessages.value = true
            intent.removeExtra(EXTRA_OPEN_MESSAGES)
        }
    }

    /** Android 13+ 需要运行时授权；拒绝后只是没有通知，不影响站内消息。 */
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
    }

    companion object {
        const val EXTRA_OPEN_MESSAGES = "open_messages"
        private const val REQUEST_NOTIFICATIONS = 100
    }
}
