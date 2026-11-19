package top.crazying.forum

import android.os.Bundle
import android.util.Log
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.BridgeActivity
import top.crazying.forum.bridge.BridgeStore
import top.crazying.forum.bridge.ForumApiPlugin
import top.crazying.forum.bridge.ForumDevicePlugin
import top.crazying.forum.bridge.ForumMediaPlugin
import top.crazying.forum.bridge.ForumSsePlugin
import top.crazying.forum.bridge.ForumUpdatePlugin
import java.util.Locale

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ForumApiPlugin::class.java)
        registerPlugin(ForumUpdatePlugin::class.java)
        registerPlugin(ForumMediaPlugin::class.java)
        registerPlugin(ForumSsePlugin::class.java)
        registerPlugin(ForumDevicePlugin::class.java)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        applySafeAreaInsets()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val imeVisible = ViewCompat.getRootWindowInsets(window.decorView)
                    ?.isVisible(WindowInsetsCompat.Type.ime()) == true
                if (imeVisible) {
                    WindowInsetsControllerCompat(window, window.decorView)
                        .hide(WindowInsetsCompat.Type.ime())
                    return
                }
                val webView = bridge?.webView
                if (webView == null) {
                    finish()
                    return
                }
                webView.evaluateJavascript("(window.__yjBack ? window.__yjBack() : false)") { result ->
                    Log.d("YjBack", "jsBack=$result")
                    if (result != "true") finish()
                }
            }
        })
    }

    /**
     * 测量状态栏 / 底部手势条（导航栏）高度并换算成 dp 存入 BridgeStore。
     * Android WebView 不向 CSS 暴露 env(safe-area-inset-*)，
     * 前端需用这里下发的数值避让刘海与手势条。
     */
    private fun applySafeAreaInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
            val density = resources.displayMetrics.density.coerceAtLeast(1f)
            val topPx = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            val bottomPx = maxOf(
                insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom,
                insets.getInsets(WindowInsetsCompat.Type.systemGestures()).bottom,
            )
            val topDp = topPx / density
            val bottomDp = bottomPx / density
            BridgeStore.safeTopDp = topDp
            BridgeStore.safeBottomDp = bottomDp
            // 兜底：inset 派发时直接把最新数值注入 WebView，
            // 避免 getAppInfo 早于首次 inset 回调而拿到 0。
            val webView = bridge?.webView
            if (webView != null) {
                // 必须用 Locale.ROOT：小数分隔符跟随系统语言（如德语为逗号）会写出
                // `--safe-top:24,0px` 这类非法 CSS，整条声明被丢弃、安全区失效。
                val topStr = String.format(Locale.ROOT, "%.1f", topDp)
                val bottomStr = String.format(Locale.ROOT, "%.1f", bottomDp)
                webView.evaluateJavascript(
                    "document.documentElement.style.setProperty('--safe-top','${topStr}px');" +
                        "document.documentElement.style.setProperty('--safe-bottom','${bottomStr}px');",
                    null,
                )
            }
            insets
        }
    }
}
