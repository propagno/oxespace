package com.oxespace.mobile.ui.live

import com.oxespace.mobile.ui.theme.OxeFonts
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
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.protocol.showHidden
import com.oxespace.mobile.protocol.RemoteDelegation
import com.oxespace.mobile.protocol.RemoteJob
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteThreadSummary
import com.oxespace.mobile.protocol.RemoteWorkspace
import com.oxespace.mobile.R
import com.oxespace.mobile.ui.UnpairDialog
import com.oxespace.mobile.session.LiveRepository
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace

private val Row = 56.dp

enum class LiveTab { THREADS, REQUESTS, TERMINALS, TASKS }

/** The connected home: conversations, requests waiting, terminals and background work on the paired desktop. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveHome(
    desktopName: String,
    /** Why the live data may be stale (reconnecting, unreachable, off the LAN), or null when connected. */
    banner: String?,
    live: LiveRepository,
    onOpenThread: (String) -> Unit,
    onOpenRequest: (RemotePendingRequest) -> Unit,
    onOpenTerminal: (RemotePane) -> Unit,
    onEnterAddress: () -> Unit,
    onUnpair: () -> Unit,
    initialTab: LiveTab = LiveTab.THREADS,
) {
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    val threads by live.threads.threads.collectAsStateWithLifecycle()
    val requests by live.pendingRequests.items.collectAsStateWithLifecycle()
    val workspaces by live.workspaces.items.collectAsStateWithLifecycle()
    val jobs by live.jobs.items.collectAsStateWithLifecycle()
    val delegations by live.delegations.items.collectAsStateWithLifecycle()
    var menu by rememberSaveable { mutableStateOf(false) }
    var confirmingUnpair by rememberSaveable { mutableStateOf(false) }
    if (confirmingUnpair) UnpairDialog(desktopName, onConfirm = { confirmingUnpair = false; onUnpair() }, onDismiss = { confirmingUnpair = false })

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
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(ImageVector.vectorResource(R.drawable.ic_more), contentDescription = stringResource(R.string.live_menu))
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.home_enter_address)) }, onClick = { menu = false; onEnterAddress() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.home_unpair)) }, onClick = { menu = false; confirmingUnpair = true })
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
            LiveTab.THREADS -> ListOrEmpty(threads, stringResource(R.string.live_empty_threads, desktopName), content) { ThreadRow(it, workspaces, onOpenThread) }
            LiveTab.REQUESTS -> ListOrEmpty(requests, stringResource(R.string.live_empty_requests), content) { RequestRow(it) { onOpenRequest(it) } }
            LiveTab.TERMINALS -> ListOrEmpty(workspaces.filter { it.panes.isNotEmpty() }, stringResource(R.string.live_empty_terminals), content) { WorkspacePanes(it, onOpenTerminal) }
            LiveTab.TASKS -> Tasks(jobs, delegations, content)
        }
    }
}

private val LiveTab.label get() = when (this) {
    LiveTab.THREADS -> R.string.live_tabs_threads
    LiveTab.REQUESTS -> R.string.live_tabs_requests
    LiveTab.TERMINALS -> R.string.live_tabs_terminals
    LiveTab.TASKS -> R.string.live_tabs_tasks
}

private val LiveTab.icon get() = when (this) {
    LiveTab.THREADS -> R.drawable.ic_threads
    LiveTab.REQUESTS -> R.drawable.ic_requests
    LiveTab.TERMINALS -> R.drawable.ic_terminal
    LiveTab.TASKS -> R.drawable.ic_tasks
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
private fun ThreadRow(thread: RemoteThreadSummary, workspaces: List<RemoteWorkspace>, onOpen: (String) -> Unit) {
    val workspace = workspaces.firstOrNull { it.id == thread.workspaceId }?.name
    Column(
        Modifier.fillMaxWidth().heightIn(min = Row).clickable(role = Role.Button) { onOpen(thread.id) }.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        Text(thread.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
            Text(threadStatusLabel(thread.status), style = MaterialTheme.typography.labelMedium, color = threadStatusColor(thread.status))
            if (thread.pendingRequests > 0) {
                Text(
                    pluralStringResource(R.plurals.live_pending_count, thread.pendingRequests.toInt(), thread.pendingRequests.toInt()),
                    style = MaterialTheme.typography.labelMedium,
                    color = Oxe.colors.intentWarningFg,
                )
            }
            if (workspace != null) Text(workspace, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun RequestRow(request: RemotePendingRequest, onOpen: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().heightIn(min = Row).clickable(role = Role.Button, onClick = onOpen).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        Text(requestTitle(request), style = MaterialTheme.typography.titleMedium)
        request.risk?.let { RiskLine(it) }
        request.command?.let { Text(showHidden(it), fontFamily = OxeFonts.mono, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis) }
        Text("${displaySafe(request.threadTitle, 200)} · ${ageLabel(request.createdAt)}", style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
    }
}

@Composable
private fun WorkspacePanes(workspace: RemoteWorkspace, onOpen: (RemotePane) -> Unit) {
    Column {
        Text(
            workspace.name,
            style = MaterialTheme.typography.labelLarge,
            color = Oxe.colors.textSecondary,
            modifier = Modifier.padding(start = OxeSpace.space4, top = OxeSpace.space3, end = OxeSpace.space4),
        )
        for (pane in workspace.panes) {
            Column(
                Modifier.fillMaxWidth().heightIn(min = Row).clickable(role = Role.Button) { onOpen(pane) }.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
                verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
            ) {
                Text(pane.title, style = MaterialTheme.typography.titleMedium)
                val agent = pane.agent
                val detail = when {
                    agent != null -> stringResource(R.string.live_pane_agent, providerName(agent), agentStateLabel(pane.agentState ?: "unknown"))
                    pane.phoneWrite -> stringResource(R.string.live_phone_write)
                    else -> stringResource(R.string.live_read_only)
                }
                Text(detail, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
            }
        }
    }
}

@Composable
private fun Tasks(jobs: List<RemoteJob>, delegations: List<RemoteDelegation>, modifier: Modifier) {
    if (jobs.isEmpty() && delegations.isEmpty()) {
        Box(modifier.padding(OxeSpace.space6)) { Text(stringResource(R.string.live_empty_tasks), style = MaterialTheme.typography.bodyLarge, color = Oxe.colors.textSecondary) }
        return
    }
    LazyColumn(modifier, contentPadding = PaddingValues(vertical = OxeSpace.space2)) {
        if (jobs.isNotEmpty()) item { Section(stringResource(R.string.live_jobs)) }
        items(jobs) { job ->
            Column(Modifier.fillMaxWidth().heightIn(min = Row).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3)) {
                Text(job.label, style = MaterialTheme.typography.titleMedium)
                val code = job.exitCode
                val status = jobStatusLabel(job.status) + if (code != null && job.status != "running") " · " + stringResource(R.string.live_exit_code, code.toString()) else ""
                Text(status, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
            }
        }
        if (delegations.isNotEmpty()) item { Section(stringResource(R.string.live_delegations)) }
        items(delegations) { delegation ->
            Column(Modifier.fillMaxWidth().heightIn(min = Row).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3)) {
                Text(delegation.objective, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(delegation.state, delegation.branch, delegation.error).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.labelLarge, color = Oxe.colors.textSecondary, modifier = Modifier.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2))
}
