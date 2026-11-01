package com.oxespace.mobile.ui.live

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.protocol.RemoteDelegation
import com.oxespace.mobile.protocol.RemoteJob
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteThreadSummary
import com.oxespace.mobile.protocol.RemoteWorkspace
import com.oxespace.mobile.R
import com.oxespace.mobile.session.LiveRepository
import com.oxespace.mobile.agents.AgentsScreen
import com.oxespace.mobile.protocol.live.CommandApi
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace

private val Row = 56.dp

/** The bottom navigation (spec §8): Agents · Requests (badge) · More. */
enum class LiveTab { AGENTS, REQUESTS, MORE }

/**
 * The connected home: every agent on the paired desktop (S7.4), the requests waiting for the person, and More (the
 * computer and its connection, the app's language, the version, unpair).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveHome(
    desktopName: String,
    /** Why the live data may be stale (reconnecting, unreachable, off the LAN), or null when connected. */
    banner: String?,
    live: LiveRepository,
    commands: CommandApi,
    onOpenThread: (String) -> Unit,
    onOpenRequest: (threadId: String, requestId: String) -> Unit,
    onOpenPane: (String) -> Unit,
    onEnterAddress: () -> Unit,
    onUnpair: () -> Unit,
    initialTab: LiveTab = LiveTab.AGENTS,
) {
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    val requests by live.pendingRequests.items.collectAsStateWithLifecycle()
    val agents by live.agents.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(desktopName, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                        if (banner != null) {
                            Text(
                                banner,
                                style = MaterialTheme.typography.labelMedium,
                                color = Oxe.colors.intentWarningFg,
                                maxLines = 2,
                                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                            )
                        }
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                for (item in LiveTab.entries) {
                    val label = stringResource(item.label)
                    val waiting = if (item == LiveTab.REQUESTS && requests.isNotEmpty()) {
                        pluralStringResource(R.plurals.live_requests_badge, requests.size, requests.size)
                    } else {
                        null
                    }
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = { tab = item },
                        // TalkBack reads the count with the tab, not only the bare number of the badge.
                        modifier = Modifier.semantics { if (waiting != null) stateDescription = waiting },
                        // One line that shrinks with large text instead of breaking a word in two.
                        label = {
                            BasicText(
                                label,
                                style = MaterialTheme.typography.labelMedium.copy(color = LocalContentColor.current),
                                maxLines = 1,
                                softWrap = false,
                                autoSize = TextAutoSize.StepBased(minFontSize = 7.sp, maxFontSize = MaterialTheme.typography.labelMedium.fontSize),
                            )
                        },
                        icon = {
                            if (waiting != null) {
                                BadgedBox(badge = { Badge(modifier = Modifier.clearAndSetSemantics { }) { Text("${requests.size}") } }) {
                                    Icon(ImageVector.vectorResource(item.icon), contentDescription = null)
                                }
                            } else {
                                Icon(ImageVector.vectorResource(item.icon), contentDescription = null)
                            }
                        },
                    )
                }
            }
        },
    ) { padding ->
        val content = Modifier.fillMaxSize().padding(padding)
        when (tab) {
            LiveTab.AGENTS -> AgentsScreen(
                desktopName = desktopName,
                state = agents,
                connected = banner == null,
                commands = commands,
                onOpenThread = onOpenThread,
                onOpenPane = onOpenPane,
                onOpenRequest = onOpenRequest,
                modifier = content,
            )
            LiveTab.REQUESTS -> ListOrEmpty(requests, stringResource(R.string.live_empty_requests), content) { RequestRow(it) { onOpenRequest(it.threadId, it.requestId) } }
            LiveTab.MORE -> MoreScreen(
                desktopName = desktopName,
                connection = banner ?: stringResource(R.string.home_status_connected, desktopName),
                onEnterAddress = onEnterAddress,
                onUnpair = onUnpair,
                modifier = content,
            )
        }
    }
}

private val LiveTab.label get() = when (this) {
    LiveTab.AGENTS -> R.string.agents_tabs_agents
    LiveTab.REQUESTS -> R.string.agents_tabs_requests
    LiveTab.MORE -> R.string.agents_tabs_more
}

private val LiveTab.icon get() = when (this) {
    LiveTab.AGENTS -> R.drawable.ic_threads
    LiveTab.REQUESTS -> R.drawable.ic_requests
    LiveTab.MORE -> R.drawable.ic_more
}

@Composable
private fun <T> ListOrEmpty(items: List<T>, empty: String, modifier: Modifier, row: @Composable (T) -> Unit) {
    if (items.isEmpty()) {
        Box(modifier.padding(OxeSpace.space6), contentAlignment = Alignment.TopStart) {
            Text(empty, style = MaterialTheme.typography.bodyLarge, color = Oxe.colors.textSecondary)
        }
        return
    }
    LazyColumn(modifier, contentPadding = PaddingValues(vertical = OxeSpace.space2)) {
        items(items) { item ->
            row(item)
            HorizontalDivider(color = Oxe.colors.borderSubtle)
        }
    }
}

@Composable
private fun RequestRow(request: RemotePendingRequest, onOpen: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().heightIn(min = Row).clickable(role = Role.Button, onClick = onOpen).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        Text(request.title, style = MaterialTheme.typography.titleMedium)
        request.risk?.let { Text(riskLabel(it), style = MaterialTheme.typography.labelMedium, color = riskColor(it)) }
        request.command?.let { Text(it, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis) }
        Text("${request.threadTitle} · ${ageLabel(request.createdAt)}", style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
    }
}
