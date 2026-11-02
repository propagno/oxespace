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

/**
 * The oldest pending request on a row. `titleCode` + `titleParams` let the phone word main's title in its own language;
 * `title` (the desktop's words, already redacted) is the fallback. Risk is one of the 4 words, or null.
 */
data class AgentRequest(
    val requestId: String,
    val title: String,
    val risk: String?,
    val answerable: Boolean,
    val titleCode: String? = null,
    val titleParams: Map<String, String>? = null,
)

/** #513 §6 RemoteAgentRow. Never on the phone: paths, worktrees, session ids, cost. */
data class AgentRow(
    val kind: String,
    val id: String,
    val state: String,
    val provider: String,
    val title: String,
    val since: Long,
    /** One counter in main for every row, strictly increasing, never going back after a restart (#513 §6). */
    val rev: Long,
    val request: AgentRequest? = null,
    val nudgeAfterMs: Long? = null,
) {
    val key: AgentKey get() = AgentKey(kind, id)
}

/** A row's identity: the same id may exist under two kinds. Also what `agent.markSeen` sends. */
data class AgentKey(val kind: String, val id: String)

/** A removal, with the rev it happened at. */
data class AgentRemoval(val kind: String, val id: String, val rev: Long) {
    val key: AgentKey get() = AgentKey(kind, id)
}

data class AgentsState(
    val rows: List<AgentRow> = emptyList(),
    /** The sources that failed this time: the screen shows the partial notice. */
    val unavailable: List<String> = emptyList(),
    /** False until the first snapshot arrives. */
    val loaded: Boolean = false,
)

/**
 * The `agents` stream as #513 §6 defines it. A snapshot replaces everything held, tombstones included. An event's
 * upserts and removals apply only when their `rev` is higher than the highest seen for that key, removed keys kept as
 * tombstones, so a late or repeated upsert never brings back a row the desktop removed, nor an older state. Rows of an
 * unknown kind are dropped; an unknown state reads as unknown where it is shown.
 */
class AgentsStore {
    private val mutable = MutableStateFlow(AgentsState())
    val state: StateFlow<AgentsState> = mutable.asStateFlow()
    /** The highest rev seen per key since the last snapshot, for the rows held and the ones removed. */
    private val newest = mutableMapOf<AgentKey, Long>()

    fun onSnapshot(rows: List<AgentRow>, unavailable: List<String>) {
        newest.clear()
        val kept = rows.filter(::known).groupBy { it.key }.mapValues { (_, same) -> same.maxBy { it.rev } }
        kept.forEach { (key, row) -> newest[key] = row.rev }
        mutable.value = AgentsState(kept.values.toList(), unavailable, loaded = true)
    }

    fun onEvent(upsert: List<AgentRow>, removed: List<AgentRemoval>, unavailable: List<String>) {
        val byKey = mutable.value.rows.associateBy { it.key }.toMutableMap()
        for (removal in removed) {
            if (removal.rev <= (newest[removal.key] ?: Long.MIN_VALUE)) continue
            newest[removal.key] = removal.rev
            byKey.remove(removal.key)
        }
        for (row in upsert) {
            if (row.rev <= (newest[row.key] ?: Long.MIN_VALUE)) continue
            newest[row.key] = row.rev
            if (known(row)) byKey[row.key] = row else byKey.remove(row.key)
        }
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

/*
 * From the C5 `agents` block (#531): the generated types into the screen's model. kind, state and the unavailable
 * sources arrive as text (the C5 unknown-value rule): an unknown state reads as unknown where it is shown, a row of an
 * unknown kind is dropped by the store, and an unknown source only adds to the partial notice.
 */
fun com.oxespace.mobile.protocol.RemoteAgentRow.toAgentRow(): AgentRow = AgentRow(
    kind = kind,
    id = id,
    state = state,
    provider = provider,
    title = title,
    since = since,
    rev = rev,
    request = request?.let { r ->
        AgentRequest(
            requestId = r.requestId,
            title = r.title,
            risk = r.risk?.wire,
            answerable = r.answerable,
            titleCode = r.titleCode,
            titleParams = r.titleParams.mapValues { (_, value) -> (value as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content ?: value.toString() },
        )
    },
    nudgeAfterMs = nudgeAfterMs,
)

fun AgentsStore.apply(snapshot: com.oxespace.mobile.protocol.RemoteAgentsSnapshot) =
    onSnapshot(snapshot.rows.map { it.toAgentRow() }, snapshot.unavailable)

fun AgentsStore.apply(event: com.oxespace.mobile.protocol.RemoteAgentsEvent) =
    onEvent(event.upsert.orEmpty().map { it.toAgentRow() }, event.removed.orEmpty().map { AgentRemoval(it.kind, it.id, it.rev) }, event.unavailable)
