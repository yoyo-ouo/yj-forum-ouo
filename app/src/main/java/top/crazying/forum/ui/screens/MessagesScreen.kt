package top.crazying.forum.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject
import top.crazying.forum.core.ApiResult
import top.crazying.forum.core.App
import top.crazying.forum.core.MessageNotifications
import top.crazying.forum.core.TimeFmt
import top.crazying.forum.theme.ForumTheme
import top.crazying.forum.ui.Navigator
import top.crazying.forum.ui.Screen
import top.crazying.forum.ui.components.Avatar
import top.crazying.forum.ui.components.EmptyBox
import top.crazying.forum.ui.components.ErrorBox
import top.crazying.forum.ui.components.ForumTextField
import top.crazying.forum.ui.components.GhostButton
import top.crazying.forum.ui.components.HDivider
import top.crazying.forum.ui.components.LineIcons
import top.crazying.forum.ui.components.LoadingBox
import top.crazying.forum.ui.components.PageScaffold
import top.crazying.forum.ui.components.toast

/**
 * 消息中心：点赞 / 评论 / 系统 / 管理团队聊天四个分类。
 *
 * 已读策略：进入某个分类并成功拿到首屏后，请求服务端以「当前时间」为界标记已读，
 * 由服务端同步通知表与分类 read_state；聊天按最后一条消息 id 标记已读。
 * 未知/偏差的客户端时间不会把未来消息提前标成已读。
 */
@Composable
fun MessagesScreen(nav: Navigator) {
    val colors = ForumTheme.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var tab by remember { mutableStateOf(0) }
    var summary by remember { mutableStateOf<JSONObject?>(null) }
    var items by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var cursor by remember { mutableStateOf("") }
    var hasMore by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var reloadKey by remember { mutableStateOf(0) }

    val categories = listOf("likes", "comments", "system", "chat")
    val labels = listOf("点赞", "评论", "系统", "聊天")

    fun counts(obj: JSONObject?): List<Int> = listOf(
        obj?.optInt("likes", 0) ?: 0,
        obj?.optInt("comments", 0) ?: 0,
        obj?.optInt("system", 0) ?: 0,
        obj?.optInt("chat", 0) ?: 0,
    )

    fun applySummary(obj: JSONObject?) {
        summary = obj
        val total = counts(obj).sum()
        App.messageUnread.value = total
        App.prefs.lastMessageTotal = total
    }

    suspend fun refreshSummary() {
        val r = App.api.messageSummary()
        if (r.ok) applySummary(r.obj())
    }

    suspend fun fetch(category: String, next: String, replace: Boolean): ApiResult {
        return when (category) {
            "likes" -> App.api.messageLikes(next.ifBlank { null })
            "comments" -> App.api.messageComments(next.ifBlank { null })
            "system" -> App.api.messageSystem(next.ifBlank { null })
            else -> App.api.chatMessages(next.ifBlank { null })
        }
    }

    suspend fun markRead(category: String, page: List<JSONObject>) {
        if (category == "chat") {
            val lastId = page.maxOfOrNull { it.optLong("id", 0L) } ?: 0L
            if (lastId > 0) App.api.markChatRead(lastId)
        } else {
            // 首屏已拉到最新一页，直接以服务端当前时间为界标记已读；
            // 不传客户端时间，避免设备时钟偏差 / 时间串比较误差导致最新一条漏标。
            App.api.markMessagesRead(category)
        }
    }

    suspend fun load(replace: Boolean) {
        if (loading || loadingMore) return
        if (replace) {
            loading = true
            error = ""
        } else {
            loadingMore = true
        }
        val category = categories[tab]
        val r = fetch(category, if (replace) "" else cursor, replace)
        loading = false
        loadingMore = false
        if (!r.ok) {
            if (replace) error = r.message
            return
        }
        val page = r.rows("items")
        items = if (replace) page else items + page
        cursor = r.str("next_cursor")
        hasMore = r.bool("has_more")
        if (replace && page.isNotEmpty()) markRead(category, page)
        refreshSummary()
    }

    LaunchedEffect(tab, reloadKey) {
        items = emptyList()
        cursor = ""
        hasMore = false
        load(replace = true)
        if (tab == 3) MessageNotifications.syncBaseline()
    }

    LaunchedEffect(Unit) { refreshSummary() }

    PageScaffold(
        title = "消息中心",
        onBack = { nav.pop() },
        actions = {
            IconButton(onClick = {
                scope.launch {
                    reloadKey++
                }
            }) {
                Icon(LineIcons.Inbox, contentDescription = "刷新", tint = colors.textPrimary)
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            val badgeCounts = counts(summary)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                labels.forEachIndexed { index, label ->
                    MessageTab(
                        label = label,
                        unread = badgeCounts.getOrElse(index) { 0 },
                        active = tab == index,
                        onClick = { if (tab != index) tab = index },
                    )
                }
            }
            HDivider()

            if (loading) {
                LoadingBox()
            } else if (error.isNotBlank() && items.isEmpty()) {
                ErrorBox(error, onRetry = { scope.launch { reloadKey++ } })
            } else if (tab == 3) {
                ChatBody(
                    rows = items,
                    hasMore = hasMore,
                    loadingMore = loadingMore,
                    onLoadMore = { scope.launch { load(replace = false) } },
                    onSend = { text ->
                        scope.launch {
                            val r = App.api.sendChat(escapeHtml(text))
                            if (!r.ok) {
                                toast(context, r.message)
                            } else {
                                load(replace = true)
                            }
                        }
                    },
                )
            } else {
                MessageList(
                    rows = items,
                    tab = tab,
                    hasMore = hasMore,
                    loadingMore = loadingMore,
                    onLoadMore = { scope.launch { load(replace = false) } },
                    onOpenPost = { postId -> if (postId.isNotBlank()) nav.push(Screen.PostDetail(postId)) },
                )
            }
        }
    }
}

@Composable
private fun MessageTab(label: String, unread: Int, active: Boolean, onClick: () -> Unit) {
    val colors = ForumTheme.colors
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (active) colors.primary else colors.bgItemActive)
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(
            text = label,
            color = if (active) colors.primaryText else colors.textSecondary,
            fontSize = 13.sp,
            fontWeight = if (active) FontWeight.Medium else FontWeight.Normal,
        )
        if (unread > 0) {
            Box(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(if (active) colors.primaryText.copy(alpha = 0.25f) else colors.danger)
                    .padding(horizontal = 5.dp, vertical = 1.dp),
            ) {
                Text(
                    text = if (unread > 99) "99+" else unread.toString(),
                    color = if (active) colors.primaryText else colors.primaryText,
                    fontSize = 10.sp,
                )
            }
        }
    }
}

@Composable
private fun MessageList(
    rows: List<JSONObject>,
    tab: Int,
    hasMore: Boolean,
    loadingMore: Boolean,
    onLoadMore: () -> Unit,
    onOpenPost: (String) -> Unit,
) {
    if (rows.isEmpty()) {
        EmptyBox("还没有消息")
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        // 系统分类由「广播 + 站内通知」两种来源合并，id 可能重复，
        // 这里不用 id 作为 key，避免 LazyColumn 因重复 key 崩溃。
        items(rows) { item ->
            MessageRow(item = item, tab = tab, onOpenPost = onOpenPost)
            HDivider(Modifier.padding(horizontal = 14.dp))
        }
        if (hasMore) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(14.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    GhostButton(
                        text = if (loadingMore) "加载中…" else "加载更多",
                        enabled = !loadingMore,
                        onClick = onLoadMore,
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageRow(item: JSONObject, tab: Int, onOpenPost: (String) -> Unit) {
    val colors = ForumTheme.colors
    if (tab == 2) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(LineIcons.Megaphone, contentDescription = null, tint = colors.primary, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    text = item.optString("title", "系统通知"),
                    color = colors.textPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(TimeFmt.fmtTime(item.optString("created_at", "")), color = colors.textMuted, fontSize = 11.sp)
            }
            val body = TimeFmt.stripHtml(item.optString("body_html", ""))
            if (body.isNotBlank()) {
                Text(
                    text = body,
                    color = colors.textSecondary,
                    fontSize = 13.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        return
    }
    val actor = item.optJSONObject("actor")
    val name = actor?.optString("name", "").orEmpty().ifBlank { "有人" }
    val avatar = actor?.optString("avatar", "")
    val postId = item.optString("post_id", "")
    val postTitle = item.optString("post_title", "")
    val detail = when (tab) {
        0 -> if (item.optString("target_type") == "comment") {
            "赞了你的评论「${item.optString("comment_excerpt", "")}」"
        } else {
            "赞了你的帖子《$postTitle》"
        }
        else -> if (item.optString("parent_id").isNotBlank()) {
            "回复了你的评论：${item.optString("excerpt", "")}"
        } else {
            "评论了你的帖子《$postTitle》：${item.optString("excerpt", "")}"
        }
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { if (postId.isNotBlank()) onOpenPost(postId) }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Avatar(avatar, 36.dp)
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, color = colors.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.width(8.dp))
                Text(TimeFmt.fmtTime(item.optString("created_at", "")), color = colors.textMuted, fontSize = 11.sp)
            }
            Text(detail, color = colors.textSecondary, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        if (postId.isNotBlank()) {
            Icon(LineIcons.ChevronRight, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun ChatBody(
    rows: List<JSONObject>,
    hasMore: Boolean,
    loadingMore: Boolean,
    onLoadMore: () -> Unit,
    onSend: (String) -> Unit,
) {
    val colors = ForumTheme.colors
    var draft by remember { mutableStateOf("") }
    Column(modifier = Modifier.fillMaxSize().imePadding()) {
        Box(modifier = Modifier.weight(1f)) {
            if (rows.isEmpty()) {
                EmptyBox("还没有和管理团队聊过")
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize(), reverseLayout = true) {
                    if (hasMore) {
                        item {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(10.dp),
                                horizontalArrangement = Arrangement.Center,
                            ) {
                                GhostButton(
                                    text = if (loadingMore) "加载中…" else "加载更早消息",
                                    enabled = !loadingMore,
                                    onClick = onLoadMore,
                                )
                            }
                        }
                    }
                    items(rows, key = { it.optLong("id", 0L) }) { msg ->
                        ChatRow(msg)
                    }
                }
            }
        }
        HDivider()
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ForumTextField(
                value = draft,
                onValueChange = { draft = it },
                placeholder = "和管理团队说点什么…",
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = {
                    val text = draft.trim()
                    if (text.isNotBlank()) {
                        draft = ""
                        onSend(text)
                    }
                },
            ) {
                Icon(LineIcons.Send, contentDescription = "发送", tint = colors.primary)
            }
        }
    }
}

@Composable
private fun ChatRow(msg: JSONObject) {
    val colors = ForumTheme.colors
    val admin = msg.optString("sender_type") == "admin"
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalArrangement = if (admin) Arrangement.Start else Arrangement.End,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth(0.82f)
                .clip(RoundedCornerShape(12.dp))
                .background(if (admin) colors.bgCard else colors.primary.copy(alpha = 0.14f))
                .border(1.dp, colors.border, RoundedCornerShape(12.dp))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = msg.optString("sender_name", if (admin) "管理团队" else "我"),
                    color = if (admin) colors.primary else colors.textPrimary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.weight(1f))
                Text(TimeFmt.fmtTime(msg.optString("created_at", "")), color = colors.textMuted, fontSize = 10.sp)
            }
            Text(
                text = TimeFmt.stripHtml(msg.optString("content_html", "")),
                color = colors.textPrimary,
                fontSize = 13.sp,
            )
        }
    }
}

private fun escapeHtml(text: String): String = text
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\n", "<br>")
    .let { "<p>$it</p>" }
