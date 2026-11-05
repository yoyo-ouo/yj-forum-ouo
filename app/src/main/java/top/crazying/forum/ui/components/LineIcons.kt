package top.crazying.forum.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.unit.dp

/**
 * 线性风格图标集（SVG 线条样式）：统一 24×24 视口、圆头描边、不填充。
 *
 * 只依赖 Compose 内置的 ImageVector，不引入额外的 material-icons-extended，
 * 用法与 `Icons.Default.*` 完全一致（`Icon(imageVector = LineIcons.Bell, ...)`）。
 */
object LineIcons {

    val Menu: ImageVector = icon("menu") {
        moveTo(4f, 7f); lineTo(20f, 7f)
        moveTo(4f, 12f); lineTo(20f, 12f)
        moveTo(4f, 17f); lineTo(20f, 17f)
    }

    val Close: ImageVector = icon("close") {
        moveTo(6f, 6f); lineTo(18f, 18f)
        moveTo(18f, 6f); lineTo(6f, 18f)
    }

    val Home: ImageVector = icon("home") {
        moveTo(4f, 11f); lineTo(12f, 4f); lineTo(20f, 11f)
        moveTo(6f, 10f); lineTo(6f, 20f); lineTo(10f, 20f); lineTo(10f, 15f)
        lineTo(14f, 15f); lineTo(14f, 20f); lineTo(18f, 20f); lineTo(18f, 10f)
    }

    val Forum: ImageVector = icon("forum") {
        moveTo(4f, 6f); lineTo(20f, 6f)
        moveTo(4f, 12f); lineTo(20f, 12f)
        moveTo(4f, 18f); lineTo(14f, 18f)
        circle(6.5f, 6f, 0.1f)
    }

    val World: ImageVector = icon("world") {
        circle(12f, 12f, 8f)
        moveTo(4f, 12f); lineTo(20f, 12f)
        moveTo(12f, 4f)
        curveTo(9f, 7f, 9f, 17f, 12f, 20f)
        moveTo(12f, 4f)
        curveTo(15f, 7f, 15f, 17f, 12f, 20f)
    }

    val Book: ImageVector = icon("book") {
        moveTo(5f, 4f); lineTo(17f, 4f)
        curveTo(19f, 4f, 20f, 5f, 20f, 7f)
        lineTo(20f, 20f); lineTo(8f, 20f)
        curveTo(6f, 20f, 5f, 19f, 5f, 17f)
        lineTo(5f, 4f)
        moveTo(5f, 17f); curveTo(5f, 15.5f, 6.5f, 15f, 8f, 15f); lineTo(20f, 15f)
    }

    val Sparkle: ImageVector = icon("sparkle") {
        moveTo(12f, 3f); lineTo(13.6f, 9.2f); lineTo(20f, 11f); lineTo(13.8f, 12.8f)
        lineTo(12f, 19f); lineTo(10.2f, 12.8f); lineTo(4f, 11f); lineTo(10.2f, 9.2f)
        close()
    }

    val User: ImageVector = icon("user") {
        circle(12f, 8f, 3.5f)
        moveTo(4.5f, 20f)
        curveTo(5f, 15.5f, 8f, 13.5f, 12f, 13.5f)
        curveTo(16f, 13.5f, 19f, 15.5f, 19.5f, 20f)
    }

    val Bell: ImageVector = icon("bell") {
        moveTo(6f, 16f); lineTo(6f, 11f)
        curveTo(6f, 7.5f, 8.7f, 5f, 12f, 5f)
        curveTo(15.3f, 5f, 18f, 7.5f, 18f, 11f)
        lineTo(18f, 16f); lineTo(20f, 18f); lineTo(4f, 18f)
        close()
        moveTo(10f, 21f); curveTo(10.6f, 22f, 11.3f, 22.3f, 12f, 22.3f)
        curveTo(12.7f, 22.3f, 13.4f, 22f, 14f, 21f)
    }

    val Message: ImageVector = icon("message") {
        moveTo(4f, 5f); lineTo(20f, 5f); lineTo(20f, 16f); lineTo(9f, 16f)
        lineTo(5f, 20f); lineTo(5f, 16f); lineTo(4f, 16f)
        close()
    }

    val Chat: ImageVector = icon("chat") {
        moveTo(3.5f, 5.5f); lineTo(15f, 5.5f); lineTo(15f, 14f); lineTo(7f, 14f)
        lineTo(4f, 17f); lineTo(4f, 14f); lineTo(3.5f, 14f)
        close()
        moveTo(15f, 9.5f); lineTo(20.5f, 9.5f); lineTo(20.5f, 18f); lineTo(17.5f, 18f)
        lineTo(17.5f, 20.5f); lineTo(14.5f, 18f); lineTo(11f, 18f); lineTo(11f, 14f)
    }

    val Heart: ImageVector = icon("heart") {
        moveTo(12f, 20f)
        curveTo(4f, 14.5f, 3f, 9.5f, 6.2f, 6.5f)
        curveTo(8.5f, 4.4f, 11f, 5.8f, 12f, 7.6f)
        curveTo(13f, 5.8f, 15.5f, 4.4f, 17.8f, 6.5f)
        curveTo(21f, 9.5f, 20f, 14.5f, 12f, 20f)
        close()
    }

    val Comment: ImageVector = icon("comment") {
        moveTo(4f, 5f); lineTo(20f, 5f); lineTo(20f, 16f); lineTo(9f, 16f)
        lineTo(5f, 20f); lineTo(5f, 16f); lineTo(4f, 16f)
        close()
        moveTo(8f, 9f); lineTo(16f, 9f)
        moveTo(8f, 12.5f); lineTo(13f, 12.5f)
    }

    val Megaphone: ImageVector = icon("megaphone") {
        moveTo(4f, 10f); lineTo(7f, 10f); lineTo(15f, 5f); lineTo(15f, 19f); lineTo(7f, 14f); lineTo(4f, 14f)
        close()
        moveTo(8f, 14f); lineTo(9.5f, 19.5f)
        moveTo(18f, 9f); lineTo(20.5f, 8f)
        moveTo(18f, 15f); lineTo(20.5f, 16f)
    }

    val Mail: ImageVector = icon("mail") {
        moveTo(4f, 6f); lineTo(20f, 6f); lineTo(20f, 18f); lineTo(4f, 18f)
        close()
        moveTo(4f, 7f); lineTo(12f, 13f); lineTo(20f, 7f)
    }

    val Search: ImageVector = icon("search") {
        circle(10.5f, 10.5f, 6f)
        moveTo(15f, 15f); lineTo(20.5f, 20.5f)
    }

    val Plus: ImageVector = icon("plus") {
        moveTo(12f, 5f); lineTo(12f, 19f)
        moveTo(5f, 12f); lineTo(19f, 12f)
    }

    val Settings: ImageVector = icon("settings") {
        moveTo(4f, 7f); lineTo(20f, 7f)
        moveTo(4f, 12f); lineTo(20f, 12f)
        moveTo(4f, 17f); lineTo(20f, 17f)
        circle(9f, 7f, 2f)
        circle(15f, 12f, 2f)
        circle(10f, 17f, 2f)
    }

    val Send: ImageVector = icon("send") {
        moveTo(4f, 11f); lineTo(20f, 4f); lineTo(15f, 20f); lineTo(11f, 12.5f)
        close()
        moveTo(11f, 12.5f); lineTo(20f, 4f)
    }

    val Inbox: ImageVector = icon("inbox") {
        moveTo(4f, 5f); lineTo(20f, 5f); lineTo(20f, 19f); lineTo(4f, 19f)
        close()
        moveTo(4f, 13f); lineTo(9f, 13f); lineTo(10.5f, 15.5f); lineTo(13.5f, 15.5f)
        lineTo(15f, 13f); lineTo(20f, 13f)
    }

    val ChevronRight: ImageVector = icon("chevron_right") {
        moveTo(9f, 5f); lineTo(16f, 12f); lineTo(9f, 19f)
    }

    val ChevronDown: ImageVector = icon("chevron_down") {
        moveTo(5f, 9f); lineTo(12f, 16f); lineTo(19f, 9f)
    }

    val Refresh: ImageVector = icon("refresh") {
        // 上半圈箭头
        moveTo(4f, 9f)
        curveTo(4.6f, 5.6f, 7.8f, 3f, 12f, 3f)
        curveTo(15.9f, 3f, 19.1f, 5.4f, 20f, 9f)
        moveTo(20f, 4f); lineTo(20f, 9f); lineTo(15f, 9f)
        // 下半圈箭头
        moveTo(20f, 15f)
        curveTo(19.4f, 18.4f, 16.2f, 21f, 12f, 21f)
        curveTo(8.1f, 21f, 4.9f, 18.6f, 4f, 15f)
        moveTo(4f, 20f); lineTo(4f, 15f); lineTo(9f, 15f)
    }

    val Moon: ImageVector = icon("moon") {
        moveTo(19f, 14.5f)
        curveTo(17.5f, 15.2f, 15.8f, 15.5f, 14.2f, 15.2f)
        curveTo(9.5f, 14.4f, 6.5f, 10f, 7.3f, 5.8f)
        curveTo(7.6f, 4.2f, 8.2f, 3.2f, 8.8f, 2.5f)
        curveTo(4.2f, 3.2f, 1.8f, 8.8f, 3.6f, 13.4f)
        curveTo(5.4f, 18f, 10.6f, 20.3f, 15.2f, 18.7f)
        curveTo(17.4f, 17.9f, 19.2f, 16.4f, 20f, 14.2f)
        curveTo(19.7f, 14.3f, 19.4f, 14.4f, 19f, 14.5f)
        close()
    }

    val Bookmark: ImageVector = icon("bookmark") {
        moveTo(6f, 4f); lineTo(18f, 4f); lineTo(18f, 20f); lineTo(12f, 16f); lineTo(6f, 20f)
        close()
    }

    val Compass: ImageVector = icon("compass") {
        circle(12f, 12f, 8f)
        moveTo(15.5f, 8.5f); lineTo(13.5f, 13.5f); lineTo(8.5f, 15.5f); lineTo(10.5f, 10.5f)
        close()
    }

    // ────────────────── 内部构建 ──────────────────

    private fun icon(name: String, block: PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        )
            .addPath(
                pathData = PathBuilder().apply(block).nodes,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.7f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
            .build()

    private fun PathBuilder.circle(cx: Float, cy: Float, r: Float) {
        moveTo(cx - r, cy)
        arcTo(r, r, 0f, true, true, cx + r, cy)
        arcTo(r, r, 0f, true, true, cx - r, cy)
        close()
    }
}
