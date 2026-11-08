package top.crazying.forum

import android.app.Application
import top.crazying.forum.bridge.BridgeStore

class ForumApp : Application() {
    override fun onCreate() {
        super.onCreate()
        BridgeStore.init(this)
    }
}
