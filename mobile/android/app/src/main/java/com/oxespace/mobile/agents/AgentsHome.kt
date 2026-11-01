package com.oxespace.mobile.agents

import com.oxespace.mobile.protocol.RemoteAgentKind
import com.oxespace.mobile.protocol.RemoteAgentMarkSeenArgs
import com.oxespace.mobile.protocol.RemoteAgentRow
import com.oxespace.mobile.protocol.RemoteAgentState

/*
 * S7.4, the phone's mission control (docs/design/s7-mission-control.md §8), on the C5 `agents` subscription (S7.1,
 * #354). The phone never maps states itself: every row arrives already in one of the seven states, computed on the
 * desktop by the shared function. Here: the list's order and chips, what the phone offers on a row, where a
 * notification leads, and what opening a row tells the desktop.
 */

/** The state of a row, by the C5 rule: a value this app doesn't know reads as UNKNOWN, so a new state needs no bump. */
fun stateOf(row: RemoteAgentRow): RemoteAgentState = RemoteAgentState.read(row.state)

/** The kind of a row; the store has already dropped rows of a kind this app doesn't know. */
fun kindOf(row: RemoteAgentRow): RemoteAgentKind? = RemoteAgentKind.read(row.kind)

/** The filter chips inside Agents (§8). */
enum class AgentFilter { ALL, NEEDS_YOU, CONVERSATIONS, TERMINALS, TASKS }

/** What the phone offers on a row (v1: conversations only act; panes and runs only open). */
enum class RowAction { RESPOND, OPEN, STOP }

/** Where a tapped notification for a row leads. */
sealed interface AgentTapTarget {
    data class Request(val threadId: String, val requestId: String) : AgentTapTarget
    data class Row(val agentId: String) : AgentTapTarget
}

/**
 * The rows a filter shows, in the shared order (§5.3): by state in the order of precedence (needs-you, failed,
 * working, finished, idle, stopped, unknown), then longest in that state first, then by id so the list never jumps.
 */
fun visibleRows(rows: List<RemoteAgentRow>, filter: AgentFilter): List<RemoteAgentRow> =
    rows.filter { row ->
        when (filter) {
            AgentFilter.ALL -> true
            AgentFilter.NEEDS_YOU -> stateOf(row) == RemoteAgentState.NEEDS_YOU
            AgentFilter.CONVERSATIONS -> kindOf(row) == RemoteAgentKind.CONVERSATION
            AgentFilter.TERMINALS -> kindOf(row) == RemoteAgentKind.PANE
            AgentFilter.TASKS -> kindOf(row) == RemoteAgentKind.WORK || kindOf(row) == RemoteAgentKind.DELEGATION
        }
    }.sortedWith(compareBy<RemoteAgentRow>({ stateOf(it).ordinal }, { it.since }, { it.id }))

/** The actions the phone offers on [row]: every row opens; only a conversation is answered or stopped (§11.2). */
fun rowActions(row: RemoteAgentRow): Set<RowAction> {
    if (kindOf(row) != RemoteAgentKind.CONVERSATION) return setOf(RowAction.OPEN)
    return buildSet {
        if (answerable(row) != null) add(RowAction.RESPOND)
        if (row.canInterrupt == true) add(RowAction.STOP)
        add(RowAction.OPEN)
    }
}

/** Where a notification about [row] opens: an answerable request with a thread goes straight to it; else the row. */
fun tapTarget(row: RemoteAgentRow): AgentTapTarget =
    answerable(row)?.let { AgentTapTarget.Request(it.threadId!!, it.requestId) } ?: AgentTapTarget.Row(row.id)

/**
 * Opening a row: the same "seen" marker as on the desktop, sent only for a finished row (the one state it clears), with
 * the `since` the phone showed, so a row that finished again after it stays Finished.
 */
fun onActivate(row: RemoteAgentRow): RemoteAgentMarkSeenArgs? =
    if (stateOf(row) == RemoteAgentState.FINISHED) RemoteAgentMarkSeenArgs(agentId = row.id, observedSince = row.since) else null

private fun answerable(row: RemoteAgentRow) = row.request?.takeIf { it.answerable && it.threadId != null }
