package top.crazying.forum.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DrawerState
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import top.crazying.forum.core.App
import top.crazying.forum.theme.ForumTheme
import top.crazying.forum.ui.components.Avatar
import top.crazying.forum.ui.components.HDivider
import top.crazying.forum.ui.components.LineIcons

/** 让各 tab 根页的左上角菜单按钮能打开全局侧栏，无需层层传参。 */
val LocalOpenDrawer = compositionLocalOf<() -> Unit> { {} }

/** 左上角菜单入口（线性三条杠图标）。 */
@Composable
fun DrawerMenuButton(tint: androidx.compose.ui.graphics.Color) {
    val open = LocalOpenDrawer.current
    IconButton(onClick = open) {
        Icon(LineIcons.Menu, contentDescription = "打开侧栏", tint = tint)
    }
}

/** 顶栏消息入口：铃铛 + 未读红点，点击进入消息中心。 */
@Composable
fun MessageEntry(nav: Navigator) {
    val colors = ForumTheme.colors
    val unread = App.messageUnread.value
    Box {
        IconButton(onClick = {
            if (nav.current !is Screen.Messages) nav.push(Screen.Messages)
        }) {
            Icon(LineIcons.Bell, contentDescription = "消息中心", tint = colors.textPrimary)
        }
        if (unread > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(end = 8.dp, top = 8.dp)
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(colors.danger),
            )
        }
    }
}

private data class DrawerEntry(
    val label: String,
    val icon: ImageVector,
    val screen: Screen,
    val badge: Boolean = false,
)

@Composable
fun ForumDrawer(
    nav: Navigator,
    drawerState: DrawerState,
    scope: CoroutineScope,
) {
    val colors = ForumTheme.colors
    val entries = listOf(
        DrawerEntry("首页", LineIcons.Home, Screen.Home),
        DrawerEntry("论坛", LineIcons.Forum, Screen.Forum),
        DrawerEntry("世界", LineIcons.World, Screen.World),
        DrawerEntry("彩蛋", LineIcons.Sparkle, Screen.EasterEgg),
        DrawerEntry("消息中心", LineIcons.Bell, Screen.Messages, badge = true),
        DrawerEntry("我的", LineIcons.User, Screen.Me),
    )

    fun close() = scope.launch { drawerState.close() }
    fun go(screen: Screen) {
        if (screen == Screen.Messages) {
            // 二级页：保留当前 tab 的栈底，返回时回到用户进来的位置
            if (nav.current !is Screen.Messages) nav.push(screen)
        } else {
            nav.switchTab(screen)
        }
        close()
    }

    ModalDrawerSheet(
        modifier = Modifier.fillMaxHeight().width(286.dp),
        drawerShape = RoundedCornerShape(topEnd = 18.dp, bottomEnd = 18.dp),
        drawerContainerColor = colors.bgBody,
        drawerContentColor = colors.textPrimary,
    ) {
        Column(modifier = Modifier.fillMaxHeight()) {
            DrawerHeader()
            HDivider(Modifier.padding(horizontal = 18.dp))
            Column(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                entries.forEach { entry ->
                    val active = when (val cur = nav.current) {
                        is Screen.Messages -> entry.screen == Screen.Messages
                        else -> cur == entry.screen && nav.isTabRoot
                    }
                    DrawerItem(
                        entry = entry,
                        active = active,
                        unread = if (entry.badge) App.messageUnread.value else 0,
                        onClick = { go(entry.screen) },
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            Text(
                text = "妖精论坛 · 客户端",
                color = colors.textMuted,
                fontSize = 11.sp,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 18.dp),
            )
        }
    }
}

@Composable
private fun DrawerHeader() {
    val colors = ForumTheme.colors
    val user = App.user.value
    val name = user?.optString("name", "").orEmpty().ifBlank { "未登录" }
    val avatar = user?.optString("avatar", "").orEmpty()
    val level = user?.optInt("level", 0) ?: 0
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 28.dp, bottom = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(avatar, 46.dp)
        Spacer(Modifier.width(12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(name, color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Text(
                text = if (App.isLoggedIn) "Lv.$level · 妖精论坛" else "登录后同步消息与收藏",
                color = colors.textMuted,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun DrawerItem(
    entry: DrawerEntry,
    active: Boolean,
    unread: Int,
    onClick: () -> Unit,
) {
    val colors = ForumTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (active) colors.bgItemActive else androidx.compose.ui.graphics.Color.Transparent)
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            entry.icon,
            contentDescription = entry.label,
            tint = if (active) colors.primary else colors.textSecondary,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(14.dp))
        Text(
            text = entry.label,
            color = if (active) colors.primary else colors.textPrimary,
            fontSize = 14.sp,
            fontWeight = if (active) FontWeight.Medium else FontWeight.Normal,
            modifier = Modifier.weight(1f),
        )
        if (unread > 0) {
            Box(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(colors.danger)
                    .padding(horizontal = 7.dp, vertical = 2.dp),
            ) {
                Text(
                    text = if (unread > 99) "99+" else unread.toString(),
                    color = colors.primaryText,
                    fontSize = 11.sp,
                )
            }
        }
    }
}
