package com.oxespace.mobile.agents

/*
 * S7.4, the phone's mission control (docs/design/s7-mission-control.md §8): DRAFT. The row below stands in for the
 * generated `RemoteAgentRow` until BACKEND's S7.1 CCR adds the `agents` subscription and `agent.markSeen` to C5
 * (shared/remote/protocol.ts → android:generate). The phone never maps states itself: every row arrives already in one
 * of the seven states, computed on the desktop by the shared function. The behaviour functions are stubs; the
 * acceptance tests (AgentsAcceptanceTest) say what they must do and stay red until S7.4 is built.
 */

/** The seven states (§3, glossary §5), in their precedence order, which is also the list's order. */
enum class AgentState { NEEDS_YOU, FAILED, WORKING, FINISHED, IDLE, STOPPED, UNKNOWN }

enum class AgentKind { PANE, CONVERSATION, DELEGATION, WORK }

/** The first request waiting on a needs-you row: enough for the row's third line and for Respond. */
data class AgentRequestDraft(
    /** Optional in C5 (#354): a request outside a conversation has none, and then only the row opens. */
    val threadId: String?,
    val requestId: String,
    /** Built by the desktop, never the agent's raw text. */
    val title: String,
    /** "low" | "medium" | "high" | "critical" once ApprovalRisk is in C5. */
    val risk: String?,
    /** False: "Responda no computador" and no Respond on the phone. */
    val answerable: Boolean,
    /** More requests waiting behind it ("+2"). */
    val more: Int = 0,
)

/** One row, as the proposed `agents` subscription would send it. No cwd, no session id, no per-row cost (§8). */
data class AgentRowDraft(
    /** Stable and opaque: `<kind>:<source id>`. */
    val id: String,
    val kind: AgentKind,
    val state: AgentState,
    /** When the row entered its state (ms); for needs-you, when it started waiting. */
    val since: Long,
    val title: String,
    val provider: String?,
    val workspaceName: String,
    val threadId: String? = null,
    val paneId: String? = null,
    val request: AgentRequestDraft? = null,
    /** Work runs only: "3 de 5 tarefas". */
    val tasksDone: Int? = null,
    val tasksTotal: Int? = null,
    /** The desktop allows Stop from the phone on this row now (v1: running conversations only). */
    val canInterrupt: Boolean = false,
)

/** The filter chips inside Agents (§8). */
enum class AgentFilter { ALL, NEEDS_YOU, CONVERSATIONS, TERMINALS, TASKS }

/** What the phone offers on a row (v1: conversations only act; panes and runs only open). */
enum class RowAction { RESPOND, OPEN, STOP }

/** Where a tapped notification for a row leads. */
sealed interface AgentTapTarget {
    data class Request(val threadId: String, val requestId: String) : AgentTapTarget
    data class Row(val agentId: String, val reason: String? = null) : AgentTapTarget
}

/** The rows a filter shows, in the list's order: needs-you longest-waiting first, then failed, working… (§5.3). */
fun visibleRows(rows: List<AgentRowDraft>, filter: AgentFilter): List<AgentRowDraft> = TODO("S7.4, after the S7.1 CCR")

/** The actions the phone offers on [row]. */
fun rowActions(row: AgentRowDraft): Set<RowAction> = TODO("S7.4, after the S7.1 CCR")

/**
 * The state for a wire value. A state the desktop adds later maps to UNKNOWN, so a new state never needs a protocol
 * bump (#354).
 */
fun agentStateOf(wire: String): AgentState = TODO("S7.4, after the S7.1 CCR")

/** Where a notification about [row] opens: an answerable request with a thread goes straight to it; anything else to the row. */
fun tapTarget(row: AgentRowDraft): AgentTapTarget = TODO("S7.4, after the S7.1 CCR")
