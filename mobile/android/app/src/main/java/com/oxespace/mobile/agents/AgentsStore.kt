@file:Suppress("UNUSED_PARAMETER", "unused")

package com.oxespace.mobile.agents

import kotlinx.coroutines.flow.StateFlow

/*
 * 1.5.0 F10 API skeleton (A43): the shapes the frozen tests call, with no behaviour. MOB-A43 replaces every TODO.
 * CCR: docs/roadmap-1.5/ccr-phone-agents-steer.md (#689) T-P2.1; tests: AgentsStoreTest, AgentsActionsTest.
 */

/** §3.1, in precedence order; the list sorts by it. A value this app doesn't know reads as UNKNOWN (C5 rule). */
enum class AgentState { NEEDS_YOU, FAILED, WORKING, FINISHED, IDLE, STOPPED, UNKNOWN }

/** The five chips, by state (DESIGN M7.7), in this order. */
enum class AgentFilter { ALL, NEEDS_YOU, WORKING, FAILED, FINISHED }

/** The oldest pending request on a row. */
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
    val rev: Long,
    val request: AgentRequest? = null,
    val nudgeAfterMs: Long? = null,
) {
    val key: AgentKey get() = TODO("F10 A43")
}

/** A row's identity: the same id may exist under two kinds. Also what `agent.markSeen` sends. */
data class AgentKey(val kind: String, val id: String)

/** A removal, with the rev it happened at. */
data class AgentRemoval(val kind: String, val id: String, val rev: Long)

data class AgentsState(
    val rows: List<AgentRow> = emptyList(),
    val unavailable: List<String> = emptyList(),
    val loaded: Boolean = false,
)

/** Where a tap leads. */
sealed interface AgentTapTarget {
    data class Request(val threadId: String, val requestId: String) : AgentTapTarget
    data class Row(val key: AgentKey) : AgentTapTarget
}

/** The `agents` stream's store: snapshots replace, events apply above the highest rev per key, removed keys stay. */
class AgentsStore {
    val state: StateFlow<AgentsState> get() = TODO("F10 A43")

    fun onSnapshot(rows: List<AgentRow>, unavailable: List<String>) {
        TODO("F10 A43")
    }

    fun onEvent(upsert: List<AgentRow>, removed: List<AgentRemoval>, unavailable: List<String>) {
        TODO("F10 A43")
    }
}

fun stateOf(row: AgentRow): AgentState = TODO("F10 A43")

fun visibleRows(rows: List<AgentRow>, filter: AgentFilter): List<AgentRow> = TODO("F10 A43")

fun chipCounts(rows: List<AgentRow>): Map<AgentFilter, Int> = TODO("F10 A43")

fun tapTarget(row: AgentRow): AgentTapTarget = TODO("F10 A43")

fun markSeenOnOpen(row: AgentRow): AgentKey? = TODO("F10 A43")
