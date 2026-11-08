package top.crazying.forum.bridge

import kotlin.math.max

object VersionCompare {
    fun compare(a: String, b: String): Int {
        val left = a.split('.').mapNotNull { it.toIntOrNull() }
        val right = b.split('.').mapNotNull { it.toIntOrNull() }
        val size = max(left.size, right.size)
        for (index in 0 until size) {
            val x = left.getOrElse(index) { 0 }
            val y = right.getOrElse(index) { 0 }
            if (x != y) return x.compareTo(y)
        }
        return 0
    }
}
