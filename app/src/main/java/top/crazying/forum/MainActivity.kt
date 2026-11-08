package top.crazying.forum

import android.os.Bundle
import android.util.Log
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.BridgeActivity
import top.crazying.forum.bridge.ForumApiPlugin
import top.crazying.forum.bridge.ForumDevicePlugin
import top.crazying.forum.bridge.ForumMediaPlugin
import top.crazying.forum.bridge.ForumSsePlugin
import top.crazying.forum.bridge.ForumUpdatePlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ForumApiPlugin::class.java)
        registerPlugin(ForumUpdatePlugin::class.java)
        registerPlugin(ForumMediaPlugin::class.java)
        registerPlugin(ForumSsePlugin::class.java)
        registerPlugin(ForumDevicePlugin::class.java)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
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
}
