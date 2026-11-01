package com.oxespace.mobile.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemoteAgentKind
import com.oxespace.mobile.protocol.RemoteAgentRow
import com.oxespace.mobile.protocol.RemoteAgentState
import com.oxespace.mobile.protocol.RemoteThreadInterruptArgs
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.protocol.live.AgentsState
import com.oxespace.mobile.protocol.live.CommandApi
import com.oxespace.mobile.protocol.live.CommandResult
import com.oxespace.mobile.ui.live.LocalClock
import com.oxespace.mobile.ui.live.ageLabel
import com.oxespace.mobile.ui.live.commandMessage
import com.oxespace.mobile.ui.live.providerName
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The phone's mission control (spec §8): every agent on the paired desktop in the shared order, filtered by chips,
 * one row each. v1 acts on conversations only: Respond (the request screen, with biometrics) and Stop (with a
 * confirmation). A pane or conversation opens its screen; a work run or delegation opens a read-only sheet. Offline,
 * the list stays readable but dimmed and its actions are paused; pull to refresh asks for the whole list again.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentsScreen(
    desktopName: String,
    state: AgentsState,
    connected: Boolean,
    commands: CommandApi,
    onOpenThread: (String) -> Unit,
    onOpenPane: (String) -> Unit,
    onOpenRequest: (threadId: String, requestId: String) -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var filter by rememberSaveable { mutableStateOf(AgentFilter.ALL) }
    var stopping by rememberSaveable { mutableStateOf<String?>(null) }
    var sheet by rememberSaveable { mutableStateOf<String?>(null) }
    var message by rememberSaveable { mutableStateOf<Int?>(null) }
    var refreshing by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val rows = visibleRows(state.rows, filter)

    // The spinner stops when the list changes, or after a few seconds if nothing came back.
    LaunchedEffect(state) { refreshing = false }
    LaunchedEffect(refreshing) { if (refreshing) { delay(REFRESH_MAX_MS); refreshing = false } }

    fun open(row: RemoteAgentRow) {
        // The same "seen" as on the desktop, for a finished row; it changes nothing else.
        onActivate(row)?.let { args -> scope.launch { commands.markSeen(args) } }
        when (kindOf(row)) {
            RemoteAgentKind.CONVERSATION -> row.threadId?.let(onOpenThread)
            RemoteAgentKind.PANE -> row.paneId?.let(onOpenPane)
            else -> sheet = row.id
        }
    }

    stopping?.let { id ->
        val row = state.rows.firstOrNull { it.id == id }
        if (row == null || RowAction.STOP !in rowActions(row)) {
            stopping = null
        } else {
            StopDialog(
                title = displaySafe(row.title, TITLE_MAX),
                onConfirm = {
                    stopping = null
                    val threadId = row.threadId ?: return@StopDialog
                    scope.launch {
                        val result = commands.interrupt(RemoteThreadInterruptArgs(threadId))
                        message = if (result is CommandResult.Done) R.string.agents_stopped else (commandMessage(result) ?: R.string.agents_stop_failed)
                    }
                },
                onDismiss = { stopping = null },
            )
        }
    }
    sheet?.let { id ->
        val row = state.rows.firstOrNull { it.id == id }
        if (row == null) sheet = null else RowSheet(row, onDismiss = { sheet = null })
    }

    Column(modifier) {
        // Single choice: TalkBack reads "Need you, not selected, 2 of 5", not a checkbox.
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).selectableGroup()
                .padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            for (chip in AgentFilter.entries) {
                val label = stringResource(chip.label)
                FilterChip(
                    selected = filter == chip,
                    onClick = { filter = chip },
                    label = { Text(label) },
                    modifier = Modifier.clearAndSetSemantics {
                        role = Role.RadioButton
                        selected = filter == chip
                        contentDescription = label
                        onClick { filter = chip; true }
                    },
                )
            }
        }
        message?.let { Notice(stringResource(it), Oxe.colors.textSecondary) }
        // Offline, the header says it once ("… Reconectando… As ações estão pausadas."); a partial notice would only add noise.
        if (connected && state.unavailable.isNotEmpty()) WarningNotice(stringResource(R.string.agents_partial))
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; onRefresh() },
            modifier = Modifier.fillMaxSize(),
        ) {
            when {
                !state.loaded -> EmptyState(stringResource(R.string.agents_loading), null)
                state.rows.isEmpty() -> EmptyState(stringResource(R.string.agents_empty, desktopName), stringResource(R.string.agents_empty_body))
                rows.isEmpty() -> EmptyState(stringResource(R.string.agents_empty_filter), null) {
                    TextButton(onClick = { filter = AgentFilter.ALL }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.agents_show_all)) }
                }
                else -> LazyColumn(Modifier.fillMaxSize().alpha(if (connected) 1f else 0.6f)) {
                    items(rows, key = { it.id }) { row ->
                        AgentRow(
                            row = row,
                            enabled = connected,
                            onOpen = { open(row) },
                            onRespond = { (tapTarget(row) as? AgentTapTarget.Request)?.let { onOpenRequest(it.threadId, it.requestId) } },
                            onStop = { stopping = row.id },
                        )
                        HorizontalDivider(color = Oxe.colors.borderSubtle)
                    }
                }
            }
        }
    }
}

@Composable
private fun AgentRow(row: RemoteAgentRow, enabled: Boolean, onOpen: () -> Unit, onRespond: () -> Unit, onStop: () -> Unit) {
    val state = stateOf(row)
    val actions = rowActions(row)
    val request = row.request
    val title = displaySafe(row.title, TITLE_MAX)
    val stateWord = stringResource(state.label)
    val workspace = displaySafe(row.workspaceName, TITLE_MAX)
    val provider = row.provider?.let(::providerName)
    val tasks = row.tasks?.let { stringResource(R.string.agents_tasks, it.done.toInt(), it.total.toInt()) }
    val requestTitle = request?.let { requestTitleText(it) }
    val more = request?.more?.toInt()?.takeIf { it > 0 }
    // Spec §5.8: "Fix the login redirect, needs you for 3 minutes, oxespace, Claude, Wants to run an action, and 1 more".
    val spoken = listOfNotNull(
        title,
        spokenSince(stateWord, row.since, ongoing = state == RemoteAgentState.NEEDS_YOU || state == RemoteAgentState.WORKING),
        workspace,
        provider,
        tasks,
        requestTitle,
        more?.let { pluralStringResource(R.plurals.agents_spoken_more, it, it) },
        request?.takeIf { !it.answerable }?.let { stringResource(R.string.agents_answer_on_computer) },
    ).joinToString(", ")
    Row(
        Modifier.fillMaxWidth().heightIn(min = if (request != null) 88.dp else 72.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f)
                .heightIn(min = if (request != null) 88.dp else 72.dp)
                .clickable(enabled = enabled, role = Role.Button, onClick = onOpen)
                .clearAndSetSemantics {
                    contentDescription = spoken
                    role = Role.Button
                    if (enabled) onClick { onOpen(); true }
                }
                .padding(start = OxeSpace.space4, end = OxeSpace.space2, top = OxeSpace.space2, bottom = OxeSpace.space2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3),
        ) {
            Box {
                Icon(ImageVector.vectorResource(kindIcon(row)), contentDescription = null, modifier = Modifier.size(24.dp), tint = Oxe.colors.textSecondary)
                Box(Modifier.align(Alignment.BottomEnd).size(10.dp).background(stateColor(state), CircleShape))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                // Only the state word carries the state's colour; the rest stays secondary.
                val stateColor = stateColor(state)
                val meta = buildAnnotatedString {
                    withStyle(SpanStyle(color = stateColor)) { append(stateWord) }
                    listOfNotNull(ageLabel(row.since), workspace, provider, tasks).forEach { append(" · "); append(it) }
                }
                Text(meta, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (requestTitle != null) {
                    // What the person must act on: never cut, it wraps at large text sizes.
                    val suffix = more?.let { " " + pluralStringResource(R.plurals.agents_more_requests, it, it) }.orEmpty()
                    Text(requestTitle + suffix, style = MaterialTheme.typography.bodyMedium)
                    if (!request.answerable) {
                        Text(stringResource(R.string.agents_answer_on_computer), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted)
                    }
                }
            }
        }
        when {
            RowAction.RESPOND in actions -> TextButton(onClick = onRespond, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp).padding(end = OxeSpace.space2)) {
                Text(stringResource(R.string.agents_action_respond))
            }
            // Secondary, not red: the list is not a wall of red, and the dialog carries the weight (spec §5.5).
            RowAction.STOP in actions -> TextButton(
                onClick = onStop,
                enabled = enabled,
                colors = ButtonDefaults.textButtonColors(contentColor = Oxe.colors.textSecondary),
                modifier = Modifier.heightIn(min = 48.dp).padding(end = OxeSpace.space2),
            ) { Text(stringResource(R.string.agents_action_stop)) }
        }
    }
}

/** The request's title in the phone's language when the desktop sent its code; else the desktop's words. */
@Composable
private fun requestTitleText(request: RemoteAgentRow.Request): String {
    val (res, args) = requestTitleString(request) ?: return displaySafe(request.title, TITLE_MAX)
    return displaySafe(stringResource(res, *args.map { displaySafe(it, PARAM_MAX) }.toTypedArray()), TITLE_MAX)
}

/**
 * The state and its time, in words: a state still going on (needs you, working) is a duration ("needs you for 3
 * minutes" / "precisa de você há 3 minutos"); any other state is a moment ("failed 2 minutes ago" / "falhou há 2 minutos").
 */
@Composable
private fun spokenSince(stateWord: String, since: Long, ongoing: Boolean): String {
    val minutes = ((LocalClock.current() - since) / 60_000).coerceAtLeast(0).toInt()
    val duration = when {
        minutes < 1 -> return stateWord
        minutes < 60 -> pluralStringResource(R.plurals.agents_duration_minutes, minutes, minutes)
        minutes < 24 * 60 -> (minutes / 60).let { pluralStringResource(R.plurals.agents_duration_hours, it, it) }
        else -> (minutes / (24 * 60)).let { pluralStringResource(R.plurals.agents_duration_days, it, it) }
    }
    return stringResource(if (ongoing) R.string.agents_spoken_since else R.string.agents_spoken_ago, stateWord.lowercase(), duration)
}

/** A work run or a delegation: what the phone knows of it, read-only; the details stay on the computer. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RowSheet(row: RemoteAgentRow, onDismiss: () -> Unit) {
    val state = stateOf(row)
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2), verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
            Text(displaySafe(row.title, TITLE_MAX), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            Text(
                listOfNotNull(stringResource(state.label), ageLabel(row.since), displaySafe(row.workspaceName, TITLE_MAX), row.provider?.let(::providerName)).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = Oxe.colors.textSecondary,
            )
            row.tasks?.let { Text(stringResource(R.string.agents_tasks, it.done.toInt(), it.total.toInt()), style = MaterialTheme.typography.bodyMedium) }
            Text(stringResource(R.string.agents_details_on_computer), style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textMuted)
            TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End).heightIn(min = 48.dp)) { Text(stringResource(R.string.agents_close)) }
        }
    }
}

@Composable
private fun StopDialog(title: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.agents_stop_title)) },
        text = { Text(stringResource(R.string.agents_stop_body, title)) },
        confirmButton = {
            TextButton(onClick = onConfirm, colors = ButtonDefaults.textButtonColors(contentColor = Oxe.colors.intentDangerFg)) {
                Text(stringResource(R.string.agents_action_confirm_stop))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.agents_action_cancel)) } },
    )
}

@Composable
private fun Notice(text: String, color: Color) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        modifier = Modifier.fillMaxWidth().padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space1).semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** The desktop's partial notice, in a warning container. */
@Composable
private fun WarningNotice(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = Oxe.colors.intentWarningFg,
        modifier = Modifier.fillMaxWidth()
            .padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space1)
            .background(Oxe.colors.intentWarningBg, RoundedCornerShape(OxeRadius.md))
            .border(1.dp, Oxe.colors.intentWarningBorder, RoundedCornerShape(OxeRadius.md))
            .padding(OxeSpace.space3)
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** The empty pattern: centred title, optional body and action; scrollable so pull to refresh still works. */
@Composable
private fun EmptyState(title: String, body: String?, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(OxeSpace.space6),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space2, Alignment.CenterVertically),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        body?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textSecondary, textAlign = TextAlign.Center) }
        action?.invoke()
    }
}

@Composable
private fun stateColor(state: RemoteAgentState): Color = with(Oxe.colors) {
    when (state) {
        RemoteAgentState.NEEDS_YOU -> intentWarningFg
        RemoteAgentState.FAILED -> intentDangerFg
        RemoteAgentState.WORKING -> intentInfoFg
        RemoteAgentState.FINISHED -> intentSuccessFg
        else -> textMuted
    }
}

private fun kindIcon(row: RemoteAgentRow): Int = when (kindOf(row)) {
    RemoteAgentKind.CONVERSATION -> R.drawable.ic_threads
    RemoteAgentKind.PANE -> R.drawable.ic_terminal
    else -> R.drawable.ic_tasks
}

private val RemoteAgentState.label: Int get() = when (this) {
    RemoteAgentState.NEEDS_YOU -> R.string.agents_state_needs_you
    RemoteAgentState.FAILED -> R.string.agents_state_failed
    RemoteAgentState.WORKING -> R.string.agents_state_working
    RemoteAgentState.FINISHED -> R.string.agents_state_finished
    RemoteAgentState.IDLE -> R.string.agents_state_idle
    RemoteAgentState.STOPPED -> R.string.agents_state_stopped
    RemoteAgentState.UNKNOWN -> R.string.agents_state_unknown
}

private val AgentFilter.label: Int get() = when (this) {
    AgentFilter.ALL -> R.string.agents_filter_all
    AgentFilter.NEEDS_YOU -> R.string.agents_filter_needs_you
    AgentFilter.CONVERSATIONS -> R.string.agents_filter_conversations
    AgentFilter.TERMINALS -> R.string.agents_filter_terminals
    AgentFilter.TASKS -> R.string.agents_filter_tasks
}

private const val TITLE_MAX = 200
private const val PARAM_MAX = 80
private const val REFRESH_MAX_MS = 5_000L
