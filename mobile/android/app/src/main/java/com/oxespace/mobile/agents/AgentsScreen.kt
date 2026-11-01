package com.oxespace.mobile.agents

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
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
import com.oxespace.mobile.ui.live.ageLabel
import com.oxespace.mobile.ui.live.commandMessage
import com.oxespace.mobile.ui.live.providerName
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace
import kotlinx.coroutines.launch

/**
 * The phone's mission control (spec §8): every agent on the paired desktop in the shared order, filtered by chips,
 * one row each. v1 acts on conversations only: Respond (the request screen, with biometrics) and Stop (with a
 * confirmation). Everything else opens. Offline, the list stays readable but dimmed and its actions are paused.
 */
@Composable
fun AgentsScreen(
    desktopName: String,
    state: AgentsState,
    connected: Boolean,
    commands: CommandApi,
    onOpenThread: (String) -> Unit,
    onOpenPane: (String) -> Unit,
    onOpenRequest: (threadId: String, requestId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var filter by rememberSaveable { mutableStateOf(AgentFilter.ALL) }
    var stopping by rememberSaveable { mutableStateOf<String?>(null) }
    var message by rememberSaveable { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    val rows = visibleRows(state.rows, filter)

    fun open(row: RemoteAgentRow) {
        // The same "seen" as on the desktop, for a finished row; it changes nothing else.
        onActivate(row)?.let { args -> scope.launch { commands.markSeen(args) } }
        when (kindOf(row)) {
            RemoteAgentKind.CONVERSATION -> row.threadId?.let(onOpenThread)
            RemoteAgentKind.PANE -> row.paneId?.let(onOpenPane)
            else -> Unit
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

    Column(modifier) {
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            for (chip in AgentFilter.entries) {
                FilterChip(selected = filter == chip, onClick = { filter = chip }, label = { Text(stringResource(chip.label)) })
            }
        }
        message?.let { Notice(stringResource(it), Oxe.colors.textSecondary) }
        if (!connected) Notice(stringResource(R.string.agents_offline_actions), Oxe.colors.intentWarningFg)
        if (state.unavailable.isNotEmpty()) Notice(stringResource(R.string.agents_partial), Oxe.colors.intentWarningFg)
        when {
            !state.loaded -> Empty(stringResource(R.string.agents_loading))
            state.rows.isEmpty() -> Empty(stringResource(R.string.agents_empty, desktopName))
            rows.isEmpty() -> Empty(stringResource(R.string.agents_empty_filter))
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

@Composable
private fun AgentRow(row: RemoteAgentRow, enabled: Boolean, onOpen: () -> Unit, onRespond: () -> Unit, onStop: () -> Unit) {
    val state = stateOf(row)
    val actions = rowActions(row)
    val request = row.request
    Row(
        Modifier.fillMaxWidth()
            .heightIn(min = if (request != null) 88.dp else 72.dp)
            .clickable(enabled = enabled, role = Role.Button, onClick = onOpen)
            .padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3),
    ) {
        Box {
            Icon(ImageVector.vectorResource(kindIcon(row)), contentDescription = null, modifier = Modifier.size(24.dp), tint = Oxe.colors.textSecondary)
            Box(Modifier.align(Alignment.BottomEnd).size(10.dp).background(stateColor(state), CircleShape))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(displaySafe(row.title, TITLE_MAX), style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(
                    stringResource(state.label),
                    ageLabel(row.since),
                    displaySafe(row.workspaceName, TITLE_MAX),
                    row.provider?.let(::providerName),
                    row.tasks?.let { stringResource(R.string.agents_tasks, it.done.toInt(), it.total.toInt()) },
                ).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = if (state == RemoteAgentState.NEEDS_YOU || state == RemoteAgentState.FAILED) stateColor(state) else Oxe.colors.textSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (request != null) {
                val more = if (request.more > 0) " " + stringResource(R.string.agents_more_requests, request.more.toInt()) else ""
                Text(displaySafe(request.title, TITLE_MAX) + more, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (!request.answerable) {
                    Text(stringResource(R.string.agents_answer_on_computer), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted)
                }
            }
        }
        when {
            RowAction.RESPOND in actions -> TextButton(onClick = onRespond, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.agents_action_respond))
            }
            RowAction.STOP in actions -> TextButton(
                onClick = onStop,
                enabled = enabled,
                colors = ButtonDefaults.textButtonColors(contentColor = Oxe.colors.intentDangerFg),
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.agents_action_stop)) }
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

@Composable
private fun Empty(text: String) {
    Text(text, style = MaterialTheme.typography.bodyLarge, color = Oxe.colors.textSecondary, modifier = Modifier.padding(OxeSpace.space4))
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
