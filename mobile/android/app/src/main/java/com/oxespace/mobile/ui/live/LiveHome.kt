package com.oxespace.mobile.ui.live

import com.oxespace.mobile.ui.theme.OxeFonts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.runtime.remember
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.agents.AgentTapTarget
import com.oxespace.mobile.agents.AgentsScreen
import com.oxespace.mobile.agents.AgentsTabIcon
import com.oxespace.mobile.agents.AgentsViewModel
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
import com.oxespace.mobile.ui.SecureScreen
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeType
import com.oxespace.mobile.ui.components.EmptyState
import com.oxespace.mobile.ui.components.OxeMark
import com.oxespace.mobile.agents.AgentState
import com.oxespace.mobile.ui.components.ProviderAvatar
import com.oxespace.mobile.ui.components.StatusGlyph
import com.oxespace.mobile.ui.components.WorkspaceChip
import com.oxespace.mobile.ui.icons.OxeIcons

private val Row = 56.dp

/** The header's gear keeps the 48 dp touch target. */
private val HeaderTarget = 48.dp

/** 1.5.2 A8 (OXE-102 CA-3): the queue is the first tab of the bottom bar and the one the home opens on. */
enum class LiveTab { REQUESTS, THREADS, TERMINALS, TASKS, AGENTS }

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
    initialTab: LiveTab = LiveTab.REQUESTS,
    /** The phone's own Settings (T-P1.7), one tap on the header's gear (OXE-102 CA-1). */
    onSettings: () -> Unit = {},
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
                    Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3), verticalAlignment = Alignment.CenterVertically) {
                    OxeMark()
                    Column {
                        Text(desktopName, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                        // Connected is said too, not only the problems: the header always tells how the phone reaches the computer.
                        if (banner == null) Text(stringResource(R.string.live_connected_hint), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted, maxLines = 1)
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
                    }
                },
                actions = {
                    IconButton(onClick = onSettings, modifier = Modifier.size(HeaderTarget)) {
                        Icon(OxeIcons.Settings, contentDescription = stringResource(R.string.live_menu_settings))
                    }
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
            BoxWithConstraints {
                val labels = LiveTab.entries.map { stringResource(it.label) }
                val labelStyle = MaterialTheme.typography.labelMedium
                val fit = tabBarFit(labels, labelStyle, maxWidth)
                NavigationBar {
                    LiveTab.entries.forEachIndexed { index, item ->
                        val label = labels[index]
                        val selected = tab == item
                        val showLabel = !fit.compact || selected
                        val waiting = if (item == LiveTab.REQUESTS && requests.isNotEmpty()) {
                            pluralStringResource(R.plurals.live_requests_badge, requests.size, requests.size)
                        } else {
                            null
                        }
                        NavigationBarItem(
                            selected = selected,
                            onClick = { tab = item },
                            // TalkBack reads the count with the tab, not only the bare number of the badge. When the
                            // labels don't fit (BRD-07), the open tab is wider so its label is whole.
                            // An icon-only tab keeps its name for TalkBack, on the tab itself so it reads as before.
                            modifier = Modifier.weight(if (fit.compact && selected) fit.openWeight else 1f)
                                .semantics {
                                    if (!showLabel) contentDescription = label
                                    if (waiting != null) stateDescription = waiting
                                },
                            alwaysShowLabel = !fit.compact,
                            // One line that shrinks with large text, never under 11 sp and never cut in a word.
                            label = if (showLabel) {
                                {
                                    BasicText(
                                        label,
                                        style = labelStyle.copy(color = LocalContentColor.current),
                                        maxLines = 1,
                                        softWrap = false,
                                        overflow = TextOverflow.Ellipsis,
                                        autoSize = TextAutoSize.StepBased(minFontSize = OxeType.text2xs, maxFontSize = labelStyle.fontSize),
                                    )
                                }
                            } else {
                                null
                            },
                            icon = {
                                if (waiting != null) {
                                    BadgedBox(badge = { Badge(containerColor = Oxe.colors.attnBg, contentColor = Oxe.colors.attnFg, modifier = Modifier.clearAndSetSemantics { }) { Text("${requests.size}") } }) {
                                        Icon(item.icon, contentDescription = null)
                                    }
                                } else {
                                    Icon(item.icon, contentDescription = null)
                                }
                            },
                        )
                    }
                }
            }
        },
    ) { padding ->
        val content = Modifier.fillMaxSize().padding(padding)
        when (tab) {
            LiveTab.THREADS -> ListOrEmpty(threads, stringResource(R.string.live_empty_threads, desktopName), content) { ThreadRow(it, workspaces, requests, onOpenThread) }
            LiveTab.REQUESTS -> {
                // SECURITY #236: each row shows the request's command, the same thing the request screen keeps out of Recents.
                SecureScreen()
                // 1.5.2 A7 (OXE-134): the "Precisa de você" queue, answered on the card.
                if (requests.isEmpty()) {
                    EmptyState(title = stringResource(R.string.live_empty_title), text = stringResource(R.string.live_empty_requests), modifier = content)
                } else {
                    NeedsYouQueue(
                        requests = requests,
                        threads = threads,
                        online = banner == null,
                        commands = live.streams.commands,
                        onOpenThread = onOpenThread,
                        onOpenRequest = onOpenRequest,
                        modifier = content,
                    )
                }
            }
            LiveTab.TERMINALS -> ListOrEmpty(workspaces.filter { it.panes.isNotEmpty() }, stringResource(R.string.live_empty_terminals), content) { WorkspacePanes(it, onOpenTerminal) }
            LiveTab.TASKS -> Tasks(jobs, delegations, content)
            LiveTab.AGENTS -> {
                val agents = remember(live) { AgentsViewModel(live) }
                AgentsScreen(agents, desktopName, content) { target ->
                    when (target) {
                        // A request still pending opens on its own screen; one already gone opens its conversation.
                        is AgentTapTarget.Request -> requests.firstOrNull { it.requestId == target.requestId }?.let(onOpenRequest) ?: onOpenThread(target.threadId)
                        is AgentTapTarget.Row -> when (target.key.kind) {
                            "thread" -> onOpenThread(target.key.id)
                            "pane" -> workspaces.flatMap { it.panes }.firstOrNull { it.id == target.key.id }?.let(onOpenTerminal)
                            else -> Unit
                        }
                    }
                }
            }
        }
    }
}

private val LiveTab.label get() = when (this) {
    LiveTab.THREADS -> R.string.live_tabs_threads
    LiveTab.REQUESTS -> R.string.live_tabs_requests
    LiveTab.TERMINALS -> R.string.live_tabs_terminals
    LiveTab.TASKS -> R.string.live_tabs_tasks
    LiveTab.AGENTS -> R.string.live_tabs_agents
}

private val LiveTab.icon: ImageVector
    @Composable get() = when (this) {
        // CR-A42b-2 (#627 HANDOFF-MOBILE "Icons"): #606's OxeChat, OxeCode and Agora, the bell for Needs you.
        LiveTab.THREADS -> OxeIcons.OxeChat
        LiveTab.REQUESTS -> OxeIcons.Bell
        LiveTab.TERMINALS -> OxeIcons.OxeCode
        LiveTab.TASKS -> OxeIcons.Clock
        LiveTab.AGENTS -> AgentsTabIcon
    }

@Composable
private fun <T> ListOrEmpty(items: List<T>, empty: String, modifier: Modifier, row: @Composable (T) -> Unit) {
    if (items.isEmpty()) {
        EmptyState(title = stringResource(R.string.live_empty_title), text = empty, modifier = modifier)
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
private fun ThreadRow(thread: RemoteThreadSummary, workspaces: List<RemoteWorkspace>, requests: List<RemotePendingRequest>, onOpen: (String) -> Unit) {
    val workspace = workspaces.firstOrNull { it.id == thread.workspaceId }
    val state = threadAgentState(thread.status, thread.lastTurnStatus, thread.pendingRequests)
    // 1.5.2 A8 (OXE-102 CA-2): floor 3 says what the conversation asks, only when it needs you.
    val asking = if (state == AgentState.NEEDS_YOU) requests.firstOrNull { it.threadId == thread.id } else null
    // CR-A42b-2 (M3): the glyph says the state at a glance, the avatar who runs it, the chip where.
    Row(
        Modifier.fillMaxWidth().heightIn(min = Row).clickable(role = Role.Button) { onOpen(thread.id) }.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3),
    ) {
        StatusGlyph(state, Modifier.padding(top = OxeSpace.space1))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(OxeSpace.space1)) {
        Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2), verticalAlignment = Alignment.CenterVertically) {
            // Floor 1: the title (bodyMedium at 600) and, at its right, how long ago (labelSmall, mono, tabular figures).
            Text(
                thread.title,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                shortAgeLabel(thread.updatedAt),
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = OxeFonts.mono, fontFeatureSettings = "tnum"),
                color = Oxe.colors.textMuted,
                maxLines = 1,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2), verticalAlignment = Alignment.CenterVertically) {
            // Floor 2: who runs it, where, and the brand's word for its state.
            ProviderAvatar(thread.provider, size = 14.dp)
            if (workspace != null) {
                Text(workspace.name, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(threadStateLabel(state), style = MaterialTheme.typography.labelMedium, color = threadStateColor(state), maxLines = 1)
        }
        if (asking != null) {
            Text(requestTitle(asking), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.attnFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        }
    }
}

@Composable
private fun WorkspacePanes(workspace: RemoteWorkspace, onOpen: (RemotePane) -> Unit) {
    Column {
        // CR-A42b-2 (T-P1.6): Terminals are grouped under their workspace's chip.
        WorkspaceChip(workspace.name, workspace.color?.toInt(), Modifier.padding(start = OxeSpace.space4, top = OxeSpace.space3, end = OxeSpace.space4))
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
        EmptyState(title = stringResource(R.string.live_empty_title), text = stringResource(R.string.live_empty_tasks), modifier = modifier)
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
                Text(listOfNotNull(stringResource(delegationStateLabel(delegation.state)), delegation.branch, delegation.error).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.labelLarge, color = Oxe.colors.textSecondary, modifier = Modifier.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2))
}

/** Material 3's NavigationBar spaces its items by 8 dp; an icon-only tab keeps the 48 dp touch target. */
private val TabSpacing = 8.dp
private val IconOnlyTab = 48.dp

/** How the bottom bar lays out its labels: all of them, or only the open tab's in a wider slot ([openWeight]). */
private class TabBarFit(val compact: Boolean, val openWeight: Float)

/**
 * BRD-07 (OXE-69): measured, never by locale. When a label does not fit its equal share of [width] even at the 11 sp
 * floor (a large system font), only the open tab shows its label, and it gets the room its longest label needs while
 * the others keep at least an icon's width.
 */
@Composable
private fun tabBarFit(labels: List<String>, style: TextStyle, width: Dp): TabBarFit {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    return remember(labels, style, width, density) {
        val count = labels.size
        val slot = (width - TabSpacing * (count - 1)) / count
        fun widthAt(label: String, size: TextUnit) = with(density) {
            measurer.measure(label, style.copy(fontSize = size), maxLines = 1, softWrap = false).size.width.toDp()
        }
        if (labels.all { widthAt(it, OxeType.text2xs) <= slot }) return@remember TabBarFit(compact = false, openWeight = 1f)
        val room = width - TabSpacing * (count - 1)
        val longest = labels.maxOf { widthAt(it, style.fontSize) }
        val open = minOf(longest + TabSpacing * 2, room - IconOnlyTab * (count - 1))
        val others = (room - open) / (count - 1)
        TabBarFit(compact = true, openWeight = maxOf(1f, open / others))
    }
}
