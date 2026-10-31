package com.oxespace.mobile.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemoteThreadItem
import com.oxespace.mobile.protocol.live.ThreadTimeline
import com.oxespace.mobile.protocol.live.id
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace

/** One conversation, live: messages, reasoning, tools, plans, requests and turn ends, newest at the bottom. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadScreen(watched: Watched<ThreadTimeline>, onBack: () -> Unit) {
    val tick by watched.changes.collectAsStateWithLifecycle()
    val timeline = watched.store
    val header = timeline.header
    val entries = remember(tick) { timeline.items }
    val list = rememberLazyListState()
    // Follow the newest item while the person is at the bottom.
    LaunchedEffect(entries.size) {
        if (entries.isNotEmpty() && (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= entries.size - 3) list.animateScrollToItem(entries.size - 1)
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(header?.title ?: stringResource(R.string.live_loading), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        header?.let { Text(threadStatusLabel(it.status), style = MaterialTheme.typography.labelMedium, color = threadStatusColor(it.status)) }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(ImageVector.vectorResource(R.drawable.ic_back), contentDescription = stringResource(R.string.live_back)) }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            state = list,
            contentPadding = PaddingValues(OxeSpace.space4),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space3),
        ) {
            if (!watched.loaded) item { Text(stringResource(R.string.live_loading), color = Oxe.colors.textSecondary) }
            if (timeline.skipped > 0) {
                item { Text(pluralStringResource(R.plurals.thread_unknown_items, timeline.skipped, timeline.skipped), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted) }
            }
            items(entries, key = { it.item.id }) { entry -> ItemView(entry.item) }
        }
    }
}

@Composable
private fun ItemView(item: RemoteThreadItem) {
    when (item) {
        is RemoteThreadItem.Message -> Bubble(
            label = stringResource(if (item.role == "user") R.string.thread_you else R.string.thread_agent),
            text = item.text,
            truncated = item.truncated == true,
            mine = item.role == "user",
        )
        is RemoteThreadItem.Reasoning -> Collapsible(stringResource(R.string.thread_reasoning), item.text, Oxe.colors.textMuted)
        is RemoteThreadItem.Tool -> ToolCard(item)
        is RemoteThreadItem.Plan -> Card {
            Text(stringResource(R.string.thread_plan), style = MaterialTheme.typography.labelLarge, modifier = Modifier.semantics { heading() })
            for (step in item.steps) {
                val mark = when (step.status) { "completed" -> "✓"; "inProgress" -> "•"; else -> "○" }
                Text("$mark ${step.label}", style = MaterialTheme.typography.bodyMedium)
            }
        }
        is RemoteThreadItem.Request -> Card {
            Text(stringResource(R.string.thread_request, item.title), style = MaterialTheme.typography.titleSmall, color = Oxe.colors.intentWarningFg)
            Text(requestStateLabel(item.state), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
        }
        is RemoteThreadItem.Subagent -> Text("${toolStateLabel(item.state)} · ${item.agents}", style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
        is RemoteThreadItem.Completed -> Text(
            completedLabel(item.status),
            style = MaterialTheme.typography.labelMedium,
            color = if (item.status == "failed") Oxe.colors.intentDangerFg else Oxe.colors.textMuted,
        )
    }
}

@Composable
private fun Bubble(label: String, text: String, truncated: Boolean, mine: Boolean) {
    Column(
        Modifier.fillMaxWidth()
            .background(if (mine) Oxe.colors.accentSoft else Oxe.colors.surfaceRaised, RoundedCornerShape(OxeRadius.lg))
            .padding(OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
        Text(text, style = MaterialTheme.typography.bodyLarge)
        if (truncated) Text(stringResource(R.string.thread_truncated), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted)
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Oxe.colors.surfaceRaised, RoundedCornerShape(OxeRadius.md)).padding(OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) { content() }
}

@Composable
private fun ToolCard(tool: RemoteThreadItem.Tool) {
    var open by rememberSaveable(tool.id) { mutableStateOf(false) }
    Card {
        Text("${tool.name} · ${toolStateLabel(tool.state)}", style = MaterialTheme.typography.labelLarge, color = if (tool.state == "failed") Oxe.colors.intentDangerFg else Oxe.colors.textSecondary)
        Text(tool.detail, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, maxLines = if (open) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
        tool.filesChanged?.takeIf { it > 0 }?.let { Text(pluralStringResource(R.plurals.thread_files_changed, it.toInt(), it.toInt()), style = MaterialTheme.typography.labelMedium) }
        tool.redacted?.takeIf { it > 0 }?.let { Text(pluralStringResource(R.plurals.terminal_redacted, it.toInt(), it.toInt()), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted) }
        val output = tool.output
        if (!output.isNullOrEmpty()) {
            if (open) Text(output, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { open = !open }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(if (open) R.string.thread_hide_output else R.string.thread_show_output))
            }
        }
    }
}

@Composable
private fun Collapsible(title: String, text: String, color: Color) {
    var open by rememberSaveable(text.hashCode()) { mutableStateOf(false) }
    Column {
        TextButton(onClick = { open = !open }, modifier = Modifier.heightIn(min = 48.dp)) { Text(title, color = color) }
        if (open) Text(text, style = MaterialTheme.typography.bodyMedium, color = color)
    }
}
