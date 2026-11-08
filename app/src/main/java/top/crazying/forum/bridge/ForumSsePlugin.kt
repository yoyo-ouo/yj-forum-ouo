package top.crazying.forum.bridge

import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import kotlin.math.min

@CapacitorPlugin(name = "ForumSse")
class ForumSsePlugin : Plugin() {
    private val client by lazy { ForumHttpClient() }
    private val factory by lazy { EventSources.createFactory(client.okHttp) }
    private val sources = mutableMapOf<String, EventSource>()
    private val lastIds = mutableMapOf<String, String>()
    private val retries = mutableMapOf<String, Int>()
    private val stopped = mutableSetOf<String>()
    private val handler = Handler(Looper.getMainLooper())

    @PluginMethod
    fun start(call: PluginCall) {
        val channel = call.getString("channel", "world") ?: "world"
        val lastId = call.getString("lastId")
        stopInternal(channel)
        stopped.remove(channel)
        if (!lastId.isNullOrBlank()) lastIds[channel] = lastId
        retries[channel] = 0
        open(channel)
        resolveOnUi(call, JSObject().put("id", channel))
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        stopInternal(call.getString("channel", "world") ?: "world")
        resolveOnUi(call, JSObject().put("success", true))
    }

    private fun open(channel: String) {
        val request = Request.Builder()
            .url(client.sseUrl(channel, lastIds[channel]))
            .apply { client.commonHeaders().forEach { (key, value) -> header(key, value) } }
            .build()

        val source = factory.newEventSource(request, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                retries[channel] = 0
                notifyState(channel, "connected")
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (!id.isNullOrBlank()) lastIds[channel] = id
                val payload = JSObject()
                    .put("channel", channel)
                    .put("event", type ?: "message")
                    .put("data", data)
                    .put("id", id)
                runOnUi { notifyListeners("sse", payload) }
            }

            override fun onClosed(eventSource: EventSource) {
                notifyState(channel, "closed")
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                if (sources[channel] !== eventSource) return
                sources.remove(channel)
                notifyState(channel, "disconnected")
                scheduleReconnect(channel)
            }
        })
        sources[channel] = source
    }

    private fun scheduleReconnect(channel: String) {
        if (stopped.contains(channel)) return
        val attempt = (retries[channel] ?: 0) + 1
        retries[channel] = attempt
        val delay = min(30_000L, 1_000L shl min(attempt, 5))
        handler.postDelayed({
            if (sources[channel] == null) open(channel)
        }, delay)
    }

    private fun stopInternal(channel: String) {
        stopped.add(channel)
        sources.remove(channel)?.cancel()
        handler.postDelayed({
            if (sources[channel] == null) notifyState(channel, "stopped")
        }, 0)
    }

    private fun notifyState(channel: String, state: String) {
        val payload = JSObject().put("channel", channel).put("state", state)
        runOnUi { notifyListeners("sseState", payload) }
    }

    private fun resolveOnUi(call: PluginCall, data: JSObject) {
        runOnUi { call.resolve(data) }
    }

    private fun runOnUi(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else handler.post(block)
    }

    override fun handleOnDestroy() {
        stopped.addAll(sources.keys)
        sources.values.forEach { it.cancel() }
        sources.clear()
        super.handleOnDestroy()
    }
}
