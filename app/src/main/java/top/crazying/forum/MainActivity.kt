package top.crazying.forum

import android.os.Bundle
import android.util.Log
import android.view.View
import androidx.activity.OnBackPressedCallback
import androidx.core.view.OnApplyWindowInsetsListener
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
     * 测量四条边的安全区并换算成 dp 存入 BridgeStore。
     * Android WebView 不向 CSS 暴露 env(safe-area-inset-*)，
     * 前端需用这里下发的数值避让刘海（横屏在左右两侧）、状态栏与手势条。
     *
     * 注意：setOnApplyWindowInsetsListener 是替换语义。capacitor.config.json 设了
     * insetsHandling=native，Capacitor 的 SystemBars 插件已把监听器装在 decorView 上，
     * 负责给 WebView 加 padding 处理 IME。这里必须先把它取回来再交还，
     * 否则键盘弹起时输入框会被遮挡（Capacitor 的监听器被顶掉）。
     *
     * androidx 没有 getOnApplyWindowInsetsListener，只能通过反射读取
     * View.mListenerInfo.mOnApplyWindowInsetsListener；反射失败时退化为不交还，
     * 安全区仍然生效（功能降级但不会崩）。
     */
    private fun applySafeAreaInsets() {
        val decor = window.decorView
        val original: OnApplyWindowInsetsListener? = readInsetsListener(decor)

        ViewCompat.setOnApplyWindowInsetsListener(decor) { view, insets ->
            val density = resources.displayMetrics.density.coerceAtLeast(1f)
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val topDp = bars.top / density
            // 底部取导航栏与手势条中较大者（全面屏手势条常单独上报）
            val bottomDp = maxOf(
                insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom,
                insets.getInsets(WindowInsetsCompat.Type.systemGestures()).bottom,
            ) / density
            val leftDp = bars.left / density
            val rightDp = bars.right / density

            BridgeStore.safeTopDp = topDp
            BridgeStore.safeBottomDp = bottomDp
            BridgeStore.safeLeftDp = leftDp
            BridgeStore.safeRightDp = rightDp

            // 兜底：inset 派发时直接把最新数值注入 WebView，
            // 避免 getAppInfo 早于首次 inset 回调而拿到 0。
            val webView = bridge?.webView
            if (webView != null) {
                // 必须用 Locale.ROOT：小数分隔符跟随系统语言（如德语为逗号）会写出
                // `--safe-top:24,0px` 这类非法 CSS，整条声明被丢弃、安全区失效。
                val script = listOf(
                    "--safe-top" to topDp,
                    "--safe-bottom" to bottomDp,
                    "--safe-left" to leftDp,
                    "--safe-right" to rightDp,
                ).joinToString("") { (name, value) ->
                    "document.documentElement.style.setProperty('$name','" +
                        String.format(Locale.ROOT, "%.1f", value) + "px');"
                }
                webView.evaluateJavascript(script, null)
            }
            // 交还 Capacitor 的监听器，由它继续处理 WebView padding / IME
            original?.onApplyWindowInsets(view, insets) ?: insets
        }
    }

    /**
     * 反射读取 decorView 上已安装的 insets 监听器（androidx 无公开 getter）。
     * 读取失败返回 null，调用方按「无原监听器」处理。
     */
    private fun readInsetsListener(view: View): OnApplyWindowInsetsListener? = runCatching {
        val listenerInfo = View::class.java
            .getDeclaredField("mListenerInfo")
            .apply { isAccessible = true }
            .get(view)
            ?: return@runCatching null
        val field = listenerInfo.javaClass.getDeclaredField("mOnApplyWindowInsetsListener")
        field.isAccessible = true
        field.get(listenerInfo) as? OnApplyWindowInsetsListener
    }.getOrNull()
}
