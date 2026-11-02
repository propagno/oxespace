package com.oxespace.mobile.agents

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/*
 * S7.4, the phone's Agents tab (docs/design/s7-mission-control.md §8), on CCR #513's C5 `agents` block.
 *
 * DRAFT until the 1.4.1 cut: AgentRow mirrors #513's RemoteAgentRow field for field, so the screen can be built and
 * tested now. When BACKEND lands the C5 block (#513 step 5) and android:generate writes RemoteAgentRow, these types
 * become aliases of the generated ones and the fake source gives way to the `agents` subscription.
 */

/** §3.1, in precedence order; the list sorts by it. A value this app doesn't know reads as UNKNOWN (C5 rule). */
enum class AgentState(val wire: String) {
    NEEDS_YOU("needs-you"), FAILED("failed"), WORKING("working"), FINISHED("finished"), IDLE("idle"), STOPPED("stopped"), UNKNOWN("unknown");

    companion object { fun read(wire: String): AgentState = entries.firstOrNull { it.wire == wire } ?: UNKNOWN }
}

/** `thread` is a conversation (#513 §2); a kind this app doesn't know is not shown at all. */
enum class AgentKind(val wire: String) {
    PANE("pane"), CONVERSATION("thread"), DELEGATION("delegation"), WORK("work");

    companion object { fun read(wire: String): AgentKind? = entries.firstOrNull { it.wire == wire } }
}

/** The oldest pending request on a row: its title is the desktop's, already redacted; risk is one of the 4 words. */
data class AgentRequest(val requestId: String, val title: String, val risk: String?, val answerable: Boolean)

/** #513 §6 RemoteAgentRow. Never on the phone: paths, worktrees, session ids, cost. */
data class AgentRow(
    val kind: String,
    val id: String,
    val state: String,
    val provider: String,
    val title: String,
    val since: Long,
    val request: AgentRequest? = null,
    val nudgeAfterMs: Long? = null,
) {
    val key: AgentKey get() = AgentKey(kind, id)
}

/** A row's identity: the same id may exist under two kinds. Also what `agent.markSeen` sends. */
data class AgentKey(val kind: String, val id: String)

data class AgentsState(
    val rows: List<AgentRow> = emptyList(),
    /** The sources that failed this time: the screen shows the partial notice. */
    val unavailable: List<String> = emptyList(),
    /** False until the first snapshot arrives. */
    val loaded: Boolean = false,
)

/**
 * The `agents` stream as #513 defines it: a snapshot replaces everything; an event upserts and removes rows by key.
 * Rows of an unknown kind are dropped. #513 carries no per-row revision, so events apply in arrival order (the stream
 * is ordered); a revision is asked for in the CCR review so a late upsert can never bring a removed row back.
 */
class AgentsStore {
    private val mutable = MutableStateFlow(AgentsState())
    val state: StateFlow<AgentsState> = mutable.asStateFlow()

    fun onSnapshot(rows: List<AgentRow>, unavailable: List<String>) {
        mutable.value = AgentsState(rows.filter(::known).associateBy { it.key }.values.toList(), unavailable, loaded = true)
    }

    fun onEvent(upsert: List<AgentRow>, removed: List<AgentKey>, unavailable: List<String>) {
        val byKey = mutable.value.rows.associateBy { it.key }.toMutableMap()
        removed.forEach { byKey.remove(it) }
        upsert.filter(::known).forEach { byKey[it.key] = it }
        mutable.value = mutable.value.copy(rows = byKey.values.toList(), unavailable = unavailable)
    }

    private fun known(row: AgentRow) = AgentKind.read(row.kind) != null
}

/** The filter chips inside Agents (§8). */
enum class AgentFilter { ALL, NEEDS_YOU, CONVERSATIONS, TERMINALS, TASKS }

/** What the phone offers on a row in v1: every row opens; only a conversation's answerable request is answered here. */
enum class RowAction { RESPOND, OPEN }

/** Where a tap leads: a conversation's answerable request straight to its request screen, else the row. */
sealed interface AgentTapTarget {
    data class Request(val threadId: String, val requestId: String) : AgentTapTarget
    data class Row(val key: AgentKey) : AgentTapTarget
}

fun stateOf(row: AgentRow): AgentState = AgentState.read(row.state)
fun kindOf(row: AgentRow): AgentKind? = AgentKind.read(row.kind)

/**
 * The rows a filter shows, in the shared order (§5.3): by state in precedence order, then longest in that state first,
 * then by kind and id so the list never jumps.
 */
fun visibleRows(rows: List<AgentRow>, filter: AgentFilter): List<AgentRow> =
    rows.filter { row ->
        when (filter) {
            AgentFilter.ALL -> true
            AgentFilter.NEEDS_YOU -> stateOf(row) == AgentState.NEEDS_YOU
            AgentFilter.CONVERSATIONS -> kindOf(row) == AgentKind.CONVERSATION
            AgentFilter.TERMINALS -> kindOf(row) == AgentKind.PANE
            AgentFilter.TASKS -> kindOf(row) == AgentKind.WORK || kindOf(row) == AgentKind.DELEGATION
        }
    }.sortedWith(compareBy<AgentRow>({ stateOf(it).ordinal }, { it.since }, { it.kind }, { it.id }))

fun rowActions(row: AgentRow): Set<RowAction> =
    if (answerableRequest(row) != null) setOf(RowAction.RESPOND, RowAction.OPEN) else setOf(RowAction.OPEN)

/** A conversation row's id is its conversation's id (#513 §2), so its request opens there. */
fun tapTarget(row: AgentRow): AgentTapTarget =
    answerableRequest(row)?.let { AgentTapTarget.Request(threadId = row.id, requestId = it.requestId) } ?: AgentTapTarget.Row(row.key)

/** Opening a finished row marks it seen on the desktop (`agent.markSeen { kind, id }`); other states send nothing. */
fun markSeenOnOpen(row: AgentRow): AgentKey? = if (stateOf(row) == AgentState.FINISHED) row.key else null

private fun answerableRequest(row: AgentRow): AgentRequest? =
    row.request?.takeIf { it.answerable && kindOf(row) == AgentKind.CONVERSATION }
