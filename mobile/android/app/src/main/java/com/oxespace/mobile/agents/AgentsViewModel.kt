package com.oxespace.mobile.agents

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Where the Agents tab gets its rows. DRAFT: only [FakeAgentsSource] until #513's C5 block lands. */
interface AgentsSource {
    fun start(store: AgentsStore)
    fun markSeen(key: AgentKey)
}

/** The Agents tab's state: the store's rows, the chosen filter and what opening a row tells the desktop. */
class AgentsViewModel(private val source: AgentsSource) : ViewModel() {
    val store = AgentsStore()
    private val chosen = MutableStateFlow(AgentFilter.ALL)
    val filter: StateFlow<AgentFilter> = chosen.asStateFlow()

    init { source.start(store) }

    fun choose(filter: AgentFilter) { chosen.value = filter }

    /** Opening a row: a finished one is marked seen; the screen then follows [tapTarget]. */
    fun open(row: AgentRow): AgentTapTarget {
        markSeenOnOpen(row)?.let(source::markSeen)
        return tapTarget(row)
    }
}

/**
 * Sample rows for the draft and for tests: one per state, every kind, a risky answerable request on a conversation and
 * an unanswerable one on a pane. Times are relative to [now].
 */
class FakeAgentsSource(private val now: Long, private val unavailable: List<String> = emptyList()) : AgentsSource {
    val seen = mutableListOf<AgentKey>()

    override fun start(store: AgentsStore) { store.onSnapshot(sampleAgents(now), unavailable) }

    override fun markSeen(key: AgentKey) { seen += key }
}

fun sampleAgents(now: Long): List<AgentRow> = listOf(
    AgentRow("thread", "t-login", "needs-you", "claude", "Fix the login redirect", now - 240_000,
        AgentRequest("r-1", "Run npm test -- auth", risk = "high", answerable = true), nudgeAfterMs = 60_000),
    AgentRow("pane", "p-3", "needs-you", "codex", "Pane 3 · Codex", now - 90_000,
        AgentRequest("r-2", "Allow access to the network", risk = null, answerable = false)),
    AgentRow("work", "w-7", "failed", "claude", "Nightly lint", now - 3_600_000),
    AgentRow("thread", "t-docs", "working", "codex", "Rewrite the setup guide", now - 420_000),
    AgentRow("delegation", "d-2", "finished", "claude", "Split the settings store", now - 1_200_000),
    AgentRow("pane", "p-1", "idle", "claude", "Pane 1 · Claude", now - 7_200_000),
    AgentRow("thread", "t-old", "stopped", "claude", "Try the new parser", now - 86_400_000),
)
