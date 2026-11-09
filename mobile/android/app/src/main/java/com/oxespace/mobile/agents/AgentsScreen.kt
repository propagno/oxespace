package com.oxespace.mobile.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.R
import com.oxespace.mobile.ui.components.Skeleton
import com.oxespace.mobile.ui.components.EmptyState
import com.oxespace.mobile.ui.components.Notice
import com.oxespace.mobile.ui.components.NoticeIntent
import com.oxespace.mobile.ui.components.ProviderAvatar
import com.oxespace.mobile.ui.components.StatusGlyph
import com.oxespace.mobile.ui.live.ageLabel
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace

/*
 * 1.5.0 F10 CR-A43 (A43). Test: androidTest AgentsTabOnDeviceTest; the rules in AgentsStoreTest / AgentsActionsTest.
 * CCR docs/roadmap-1.5/ccr-phone-agents-steer.md (#689) T-P2.1. The rows come only from the C5 `agents` topic through
 * [AgentsViewModel]; the five chips are by state (DESIGN M7.7), each with its count, and only the Needs you count is in
 * the sun. A tap follows [tapTarget]; opening a finished row marks it seen ([AgentsViewModel.open]).
 */

/** The Agents tab's icon: #606's Agora (CR-A42b-2, #627 HANDOFF-MOBILE "Icons"). */
val AgentsTabIcon: ImageVector get() = com.oxespace.mobile.ui.icons.OxeIcons.Agora

@Composable
fun AgentsScreen(
    model: AgentsViewModel,
    desktopName: String,
    modifier: Modifier = Modifier,
    onOpen: (AgentTapTarget) -> Unit,
) {
    val state by model.state.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(AgentFilter.ALL) }
    val counts = remember(state.rows) { chipCounts(state.rows) }
    val shown = remember(state.rows, filter) { visibleRows(state.rows, filter) }
    Column(modifier) {
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = OxeSpace.space3),
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space1),
        ) {
            for (chip in AgentFilter.entries) {
                // CR-F10-10: no count until the list has loaded; a "0" there would be a claim.
                val count = if (state.loaded) counts[chip] ?: 0 else null
                Chip(stringResource(chip.label), count, selected = chip == filter, sun = chip == AgentFilter.NEEDS_YOU && (count ?: 0) > 0) { filter = chip }
            }
        }
        if (state.unavailable.isNotEmpty()) {
            Notice(
                intent = NoticeIntent.INFO,
                title = stringResource(R.string.live_agents_partial_title),
                text = stringResource(R.string.live_agents_partial_text),
                modifier = Modifier.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
            )
        }
        when {
            // CR-F10-10: the skeleton while loading, not a "Carregando…" line.
            !state.loaded -> Skeleton(Modifier.padding(OxeSpace.space4), lines = 4)
            state.rows.isEmpty() -> EmptyState(
                title = stringResource(R.string.live_agents_empty_title),
                text = stringResource(R.string.live_agents_empty_text, desktopName),
                icon = AgentsTabIcon,
            )
            shown.isEmpty() -> EmptyState(
                title = stringResource(R.string.live_agents_empty_filter_title),
                text = stringResource(R.string.live_agents_empty_filter_text),
                icon = AgentsTabIcon,
            )
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = OxeSpace.space2)) {
                items(shown, key = { "${it.kind}:${it.id}" }) { row ->
                    AgentListRow(row) {
                        model.open(row)
                        onOpen(tapTarget(row))
                    }
                    HorizontalDivider(color = Oxe.colors.borderSubtle)
                }
            }
        }
    }
}

private val AgentFilter.label get() = when (this) {
    AgentFilter.ALL -> R.string.live_agents_chip_all
    AgentFilter.NEEDS_YOU -> R.string.live_agents_chip_needs_you
    AgentFilter.WORKING -> R.string.live_agents_chip_working
    AgentFilter.FAILED -> R.string.live_agents_chip_failed
    AgentFilter.FINISHED -> R.string.live_agents_chip_finished
}

/** A chip: a 48 dp target around a 32 dp pill with its label and count. [sun] puts the count, and only the count, in attn. */
@Composable
private fun Chip(label: String, count: Int?, selected: Boolean, sun: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Box(
        Modifier
            .heightIn(min = 48.dp)
            .semantics(mergeDescendants = true) {}
            .selectable(selected = selected, role = Role.Tab, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .heightIn(min = 32.dp)
                .background(if (selected) Oxe.colors.surfaceSunken else Color.Transparent, shape)
                .border(1.dp, if (selected) Oxe.colors.accent else Oxe.colors.borderDefault, shape)
                .padding(horizontal = OxeSpace.space3),
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = Oxe.colors.textPrimary, maxLines = 1)
            val countColor = if (sun) Oxe.colors.attn else Oxe.colors.textSecondary
            if (count != null) Text("$count", style = MaterialTheme.typography.labelLarge, color = countColor, maxLines = 1)
        }
    }
}

@Composable
private fun AgentListRow(row: AgentRow, onOpen: () -> Unit) {
    val state = stateOf(row)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusGlyph(state)
        ProviderAvatar(row.provider)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(OxeSpace.space1)) {
            Text(row.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val detail = listOfNotNull(stateLabel(state), row.request?.title, ageLabel(row.since)).joinToString(" · ")
            Text(detail, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The row's state in the phone's words; the row's text says it, the glyph is decoration. */
@Composable
private fun stateLabel(state: AgentState): String = stringResource(
    when (state) {
        AgentState.NEEDS_YOU -> R.string.live_agents_chip_needs_you
        AgentState.WORKING -> R.string.live_agents_chip_working
        AgentState.FAILED -> R.string.live_agents_chip_failed
        AgentState.FINISHED -> R.string.live_agents_chip_finished
        AgentState.IDLE -> R.string.live_status_idle
        AgentState.STOPPED -> R.string.live_status_interrupted
        AgentState.UNKNOWN -> R.string.live_agent_state_unknown
    },
)
