package com.oxespace.mobile.agents

import com.oxespace.mobile.session.LiveRepository
import kotlinx.coroutines.flow.StateFlow

/*
 * 1.5.0 A43. Test: androidTest AgentsOnDeviceTest. The rows come only from the C5 `agents` stream; no fake source.
 */

/** The Agents tab: follows the C5 `agents` stream through [LiveRepository] and sends `agent.markSeen` on a finished row. */
class AgentsViewModel(private val repository: LiveRepository) {
    val state: StateFlow<AgentsState> get() = repository.agents.state

    /** The key last opened that should be marked seen; see [open]. */
    @Volatile var pendingMarkSeen: AgentKey? = null
        private set

    /**
     * Opening a row: a finished one is marked seen (`agent.markSeen { kind, id }`, CR-F10-7); every other state sends
     * nothing.
     */
    fun open(row: AgentRow) {
        markSeenOnOpen(row)?.let {
            pendingMarkSeen = it
            repository.markAgentSeen(it)
        }
    }
}
