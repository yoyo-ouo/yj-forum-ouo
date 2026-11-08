package top.crazying.forum.bridge

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject

object JsonUtil {
    fun toQuery(obj: JSObject?): Map<String, String> {
        if (obj == null) return emptyMap()
        val out = linkedMapOf<String, String>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val value = obj.opt(key)
            if (value != null && value != JSONObject.NULL) out[key] = value.toString()
        }
        return out
    }

    fun parse(raw: String?): Any? {
        val text = raw?.trim().orEmpty()
        if (text.isEmpty()) return null
        return runCatching {
            if (text.startsWith("[")) JSONArray(text) else JSONObject(text)
        }.getOrNull()
    }

    fun toJs(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> toJsObject(value)
        is JSONArray -> toJsArray(value)
        is JSObject, is JSArray -> value
        else -> value
    }

    fun toJsObject(value: JSONObject): JSObject {
        val out = JSObject()
        val keys = value.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            out.put(key, toJs(value.opt(key)))
        }
        return out
    }

    fun toJsArray(value: JSONArray): JSArray {
        val out = JSArray()
        for (i in 0 until value.length()) out.put(toJs(value.opt(i)))
        return out
    }
}
