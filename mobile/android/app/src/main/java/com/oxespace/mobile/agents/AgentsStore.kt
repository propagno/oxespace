package com.oxespace.mobile.agents

import com.oxespace.mobile.protocol.RemoteAgentRow
import com.oxespace.mobile.protocol.RemoteAgentsEvent
import com.oxespace.mobile.protocol.RemoteAgentsSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonPrimitive

/*
 * 1.5.0 A43, the phone's Agents tab on the C5 `agents` topic (#531). CCR docs/roadmap-1.5/ccr-phone-agents-steer.md
 * (#689) T-P2.1, ported from #521's Agents.kt without its fake source; the chips are by state (DESIGN M7.7).
 */

/** §3.1, in precedence order; the list sorts by it. A value this app doesn't know reads as UNKNOWN (C5 rule). */
enum class AgentState(val wire: String) {
    NEEDS_YOU("needs-you"), FAILED("failed"), WORKING("working"), FINISHED("finished"), IDLE("idle"), STOPPED("stopped"), UNKNOWN("unknown");

    companion object {
        fun read(wire: String): AgentState = entries.firstOrNull { it != UNKNOWN && it.wire == wire } ?: UNKNOWN
    }
}

/** `thread` is a conversation; a kind this app doesn't know is not shown at all. */
enum class AgentKind(val wire: String) {
    PANE("pane"), CONVERSATION("thread"), DELEGATION("delegation"), WORK("work");

    companion object {
        fun read(wire: String): AgentKind? = entries.firstOrNull { it.wire == wire }
    }
}

/** The five chips, by state (DESIGN M7.7), in this order. Idle, stopped and unknown rows show under All only. */
enum class AgentFilter(val state: AgentState?) {
    ALL(null), NEEDS_YOU(AgentState.NEEDS_YOU), WORKING(AgentState.WORKING), FAILED(AgentState.FAILED), FINISHED(AgentState.FINISHED)
}

/**
 * The oldest pending request on a row. `titleCode` + `titleParams` let the phone word main's title in its own language;
 * `title` (the desktop's words, already redacted) is the fallback. Risk is one of the four words, or null.
 */
data class AgentRequest(
    val requestId: String,
    val title: String,
    val risk: String?,
    val answerable: Boolean,
    val titleCode: String? = null,
    val titleParams: Map<String, String>? = null,
)

/** C5 RemoteAgentRow as the screen holds it. Never on the phone: paths, worktrees, session ids, cost. */
data class AgentRow(
    val kind: String,
    val id: String,
    val state: String,
    val provider: String,
    val title: String,
    val since: Long,
    /** One counter in main for every row, strictly increasing. */
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

/** Where a tap leads. */
sealed interface AgentTapTarget {
    data class Request(val threadId: String, val requestId: String) : AgentTapTarget
    data class Row(val key: AgentKey) : AgentTapTarget
}

/**
 * The `agents` stream's store. A snapshot replaces everything held, tombstones included. An event's upserts and
 * removals apply only when their `rev` is higher than the highest seen for that key, removed keys kept, so a late or
 * repeated upsert never brings back a removed row nor an older state. Rows of an unknown kind are dropped.
 */
class AgentsStore {
    private val mutable = MutableStateFlow(AgentsState())
    val state: StateFlow<AgentsState> = mutable.asStateFlow()

    /** The highest rev seen per key since the last snapshot, for the rows held and the ones removed. */
    private val newest = mutableMapOf<AgentKey, Long>()
    private val lock = Any()

    fun onSnapshot(rows: List<AgentRow>, unavailable: List<String>) = synchronized(lock) {
        newest.clear()
        val kept = rows.filter(::known).groupBy { it.key }.mapValues { (_, same) -> same.maxBy { it.rev } }
        kept.forEach { (key, row) -> newest[key] = row.rev }
        mutable.value = AgentsState(ordered(kept.values), unavailable.toList(), loaded = true)
    }

    fun onEvent(upsert: List<AgentRow>, removed: List<AgentRemoval>, unavailable: List<String>) = synchronized(lock) {
        val byKey = mutable.value.rows.associateByTo(LinkedHashMap()) { it.key }
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
        mutable.value = mutable.value.copy(rows = ordered(byKey.values), unavailable = unavailable.toList())
    }

    private fun known(row: AgentRow) = AgentKind.read(row.kind) != null
}

private val shownOrder = compareBy<AgentRow>({ stateOf(it).ordinal }, { it.since }, { it.kind }, { it.id })

private fun ordered(rows: Collection<AgentRow>): List<AgentRow> = rows.sortedWith(shownOrder)

fun stateOf(row: AgentRow): AgentState = AgentState.read(row.state)

fun kindOf(row: AgentRow): AgentKind? = AgentKind.read(row.kind)

/**
 * The rows a chip shows, in the shared order: by state in precedence order, then longest in that state first, then by
 * kind and id so the list never jumps.
 */
fun visibleRows(rows: List<AgentRow>, filter: AgentFilter): List<AgentRow> =
    rows.filter { row -> filter.state == null || stateOf(row) == filter.state }.sortedWith(shownOrder)

/** Each chip's count: the number of rows it shows. */
fun chipCounts(rows: List<AgentRow>): Map<AgentFilter, Int> =
    AgentFilter.entries.associateWith { filter -> rows.count { filter.state == null || stateOf(it) == filter.state } }

/** A conversation row's id is its conversation's id, so its answerable request opens there; anything else opens the row. */
fun tapTarget(row: AgentRow): AgentTapTarget =
    answerableRequest(row)?.let { AgentTapTarget.Request(threadId = row.id, requestId = it.requestId) } ?: AgentTapTarget.Row(row.key)

/** Opening a finished row marks it seen on the desktop (`agent.markSeen { kind, id }`); other states send nothing. */
fun markSeenOnOpen(row: AgentRow): AgentKey? = if (stateOf(row) == AgentState.FINISHED) row.key else null

private fun answerableRequest(row: AgentRow): AgentRequest? =
    row.request?.takeIf { it.answerable && kindOf(row) == AgentKind.CONVERSATION }

/*
 * From the C5 `agents` block (#531): the generated types into the screen's model. kind, state and the unavailable
 * sources arrive as text (the C5 unknown-value rule).
 */
fun RemoteAgentRow.toAgentRow(): AgentRow = AgentRow(
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
            titleParams = r.titleParams.mapValues { (_, value) -> (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: value.toString() },
        )
    },
    nudgeAfterMs = nudgeAfterMs,
)

fun AgentsStore.apply(snapshot: RemoteAgentsSnapshot) =
    onSnapshot(snapshot.rows.map { it.toAgentRow() }, snapshot.unavailable)

fun AgentsStore.apply(event: RemoteAgentsEvent) =
    onEvent(event.upsert.orEmpty().map { it.toAgentRow() }, event.removed.orEmpty().map { AgentRemoval(it.kind, it.id, it.rev) }, event.unavailable)
