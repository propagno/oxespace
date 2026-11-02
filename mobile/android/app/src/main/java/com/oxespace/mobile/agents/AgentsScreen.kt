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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.ui.live.LocalClock
import com.oxespace.mobile.ui.live.ageLabel
import com.oxespace.mobile.ui.live.providerName
import com.oxespace.mobile.ui.live.riskLevel
import com.oxespace.mobile.ui.live.riskWord
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import kotlinx.coroutines.delay

/**
 * The phone's Agents tab (spec §8, S7.4) on CCR #513: every agent on the paired desktop in the shared order, filtered by
 * chips, one row each. v1 answers only a conversation's request here (Respond); Stop lives in the conversation screen.
 * A conversation or pane opens its screen; a work run or delegation opens a read-only sheet. Offline, a banner says
 * which computer is out of reach and how old the list is, and the list stays readable but dimmed and does nothing.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentsScreen(
    desktopName: String,
    state: AgentsState,
    filter: AgentFilter,
    connected: Boolean,
    onFilter: (AgentFilter) -> Unit,
    onOpen: (AgentRow) -> AgentTapTarget,
    onOpenConversation: (String) -> Unit,
    onOpenPane: (String) -> Unit,
    onOpenRequest: (threadId: String, requestId: String) -> Unit,
    modifier: Modifier = Modifier,
    /** When the list was last brought up to date; shown in the offline banner. */
    updatedAt: Long? = null,
    /** Skeleton rows appear only if loading lasts longer than this (DESIGN #521), so a fast load doesn't flash. */
    skeletonDelayMs: Long = SKELETON_DELAY_MS,
) {
    var sheet by rememberSaveable { mutableStateOf<String?>(null) }
    val rows = visibleRows(state.rows, filter)

    fun open(row: AgentRow) {
        when (val target = onOpen(row)) {
            is AgentTapTarget.Request -> onOpenRequest(target.threadId, target.requestId)
            is AgentTapTarget.Row -> when (kindOf(row)) {
                AgentKind.CONVERSATION -> onOpenConversation(row.id)
                AgentKind.PANE -> onOpenPane(row.id)
                else -> sheet = "${row.kind}:${row.id}"
            }
        }
    }

    sheet?.let { key ->
        val row = state.rows.firstOrNull { "${it.kind}:${it.id}" == key }
        if (row == null) sheet = null else RowSheet(row, onDismiss = { sheet = null })
    }

    Column(modifier) {
        // Single choice: TalkBack reads "Need you, not selected", not a checkbox.
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).selectableGroup()
                .padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            for (chip in AgentFilter.entries) {
                val label = stringResource(chip.label)
                FilterChip(
                    selected = filter == chip,
                    onClick = { onFilter(chip) },
                    label = { Text(label) },
                    modifier = Modifier.clearAndSetSemantics {
                        role = Role.RadioButton
                        selected = filter == chip
                        contentDescription = label
                        onClick { onFilter(chip); true }
                    },
                )
            }
        }
        if (!connected && state.loaded) OfflineNotice(desktopName, updatedAt)
        if (connected && state.unavailable.isNotEmpty()) WarningNotice(stringResource(R.string.agents_partial))
        when {
            !state.loaded -> Skeleton(skeletonDelayMs)
            state.rows.isEmpty() -> EmptyState(stringResource(R.string.agents_empty, desktopName), stringResource(R.string.agents_empty_body))
            rows.isEmpty() -> EmptyState(stringResource(R.string.agents_empty_filter, stringResource(filter.label)), null) {
                TextButton(onClick = { onFilter(AgentFilter.ALL) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.agents_show_all)) }
            }
            else -> LazyColumn(Modifier.fillMaxSize().alpha(if (connected) 1f else 0.6f)) {
                items(rows, key = { "${it.kind}:${it.id}" }) { row ->
                    AgentRowItem(row = row, enabled = connected, onOpen = { open(row) })
                    HorizontalDivider(color = Oxe.colors.borderSubtle)
                }
            }
        }
    }
}

@Composable
private fun AgentRowItem(row: AgentRow, enabled: Boolean, onOpen: () -> Unit) {
    val state = stateOf(row)
    val request = row.request
    val title = displaySafe(row.title, TITLE_MAX)
    val stateWord = stringResource(state.label)
    // A pane's title already names its agent ("Pane 3 · Codex"): the provider isn't repeated (DESIGN #521).
    val provider = if (kindOf(row) == AgentKind.PANE) null else providerName(displaySafe(row.provider, PROVIDER_MAX))
    val requestTitle = request?.let { displaySafe(it.title, TITLE_MAX) }
    val risk = request?.risk?.let { riskWord(riskLevel(it)) }
    // Spec §5.8: "Fix the login redirect, needs you for 3 minutes, Claude, Run npm test, High risk".
    val spoken = listOfNotNull(
        title,
        spokenSince(stateWord, row.since, ongoing = state == AgentState.NEEDS_YOU || state == AgentState.WORKING),
        provider,
        requestTitle,
        risk,
        request?.takeIf { !it.answerable }?.let { stringResource(R.string.agents_answer_on_computer) },
    ).joinToString(", ")
    val respond = RowAction.RESPOND in rowActions(row)
    Row(Modifier.fillMaxWidth().heightIn(min = if (request != null) 88.dp else 72.dp), verticalAlignment = Alignment.CenterVertically) {
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
                val color = stateColor(state)
                val meta = buildAnnotatedString {
                    withStyle(SpanStyle(color = color)) { append(stateWord) }
                    listOfNotNull(ageLabel(row.since), provider).forEach { append(" · "); append(it) }
                }
                Text(meta, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (requestTitle != null) {
                    // What the person must act on: never cut, it wraps at large text sizes. The risk is a word, never a colour.
                    Text(listOfNotNull(requestTitle, risk).joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
                    if (!request.answerable) {
                        Text(stringResource(R.string.agents_answer_on_computer), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted)
                    }
                }
            }
        }
        if (respond) {
            TextButton(onClick = onOpen, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp).padding(end = OxeSpace.space2)) {
                Text(stringResource(R.string.agents_action_respond))
            }
        }
    }
}

/**
 * The state and its time, in words: a state still going on (needs you, working) is a duration ("needs you for 3
 * minutes" / "precisa de você há 3 minutos"); any other state is a moment ("failed 2 minutes ago").
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
private fun RowSheet(row: AgentRow, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            Text(displaySafe(row.title, TITLE_MAX), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            Text(
                listOf(stringResource(stateOf(row).label), ageLabel(row.since), providerName(displaySafe(row.provider, PROVIDER_MAX))).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = Oxe.colors.textSecondary,
            )
            Text(stringResource(R.string.agents_details_on_computer), style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textMuted)
            TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End).heightIn(min = 48.dp)) { Text(stringResource(R.string.agents_close)) }
        }
    }
}

/** Offline: which computer is out of reach, how old the list is, and why nothing can be done until it is back. */
@Composable
private fun OfflineNotice(desktopName: String, updatedAt: Long?) {
    val head = updatedAt?.let { stringResource(R.string.agents_offline, desktopName, ageLabel(it)) }
        ?: stringResource(R.string.agents_offline_now, desktopName)
    Text(
        head + "\n" + stringResource(R.string.agents_offline_actions),
        style = MaterialTheme.typography.bodyMedium,
        color = Oxe.colors.textSecondary,
        modifier = Modifier.fillMaxWidth()
            .padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space1)
            .background(Oxe.colors.surfaceSunken, RoundedCornerShape(OxeRadius.md))
            .border(1.dp, Oxe.colors.borderSubtle, RoundedCornerShape(OxeRadius.md))
            .padding(OxeSpace.space3)
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** Loading: nothing for a moment, then three placeholder rows; TalkBack hears "Loading agents…" once. */
@Composable
private fun Skeleton(delayMs: Long) {
    var shown by remember { mutableStateOf(delayMs <= 0L) }
    LaunchedEffect(delayMs) { if (delayMs > 0L) { delay(delayMs); shown = true } }
    val loading = stringResource(R.string.agents_loading)
    Column(Modifier.fillMaxSize().semantics { contentDescription = loading; liveRegion = LiveRegionMode.Polite }) {
        if (!shown) return@Column
        repeat(3) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
                horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(24.dp).background(Oxe.colors.borderSubtle, RoundedCornerShape(OxeRadius.sm)))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                    Box(Modifier.fillMaxWidth(0.6f).heightIn(min = 14.dp).background(Oxe.colors.borderSubtle, RoundedCornerShape(OxeRadius.sm)))
                    Box(Modifier.fillMaxWidth(0.4f).heightIn(min = 10.dp).background(Oxe.colors.borderSubtle, RoundedCornerShape(OxeRadius.sm)))
                }
            }
            HorizontalDivider(color = Oxe.colors.borderSubtle)
        }
    }
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

/** The empty pattern: centred title, optional body and action. */
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
private fun stateColor(state: AgentState): Color = with(Oxe.colors) {
    when (state) {
        AgentState.NEEDS_YOU -> intentWarningFg
        AgentState.FAILED -> intentDangerFg
        AgentState.WORKING -> intentInfoFg
        AgentState.FINISHED -> intentSuccessFg
        else -> textMuted
    }
}

private fun kindIcon(row: AgentRow): Int = when (kindOf(row)) {
    AgentKind.CONVERSATION -> R.drawable.ic_threads
    AgentKind.PANE -> R.drawable.ic_terminal
    else -> R.drawable.ic_tasks
}

private val AgentState.label: Int get() = when (this) {
    AgentState.NEEDS_YOU -> R.string.agents_state_needs_you
    AgentState.FAILED -> R.string.agents_state_failed
    AgentState.WORKING -> R.string.agents_state_working
    AgentState.FINISHED -> R.string.agents_state_finished
    AgentState.IDLE -> R.string.agents_state_idle
    AgentState.STOPPED -> R.string.agents_state_stopped
    AgentState.UNKNOWN -> R.string.agents_state_unknown
}

private val AgentFilter.label: Int get() = when (this) {
    AgentFilter.ALL -> R.string.agents_filter_all
    AgentFilter.NEEDS_YOU -> R.string.agents_filter_needs_you
    AgentFilter.CONVERSATIONS -> R.string.agents_filter_conversations
    AgentFilter.TERMINALS -> R.string.agents_filter_terminals
    AgentFilter.TASKS -> R.string.agents_filter_tasks
}

private const val TITLE_MAX = 200
private const val PROVIDER_MAX = 40
private const val SKELETON_DELAY_MS = 300L
