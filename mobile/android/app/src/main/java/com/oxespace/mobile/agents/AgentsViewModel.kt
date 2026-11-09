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
     * Opening a row: a finished one is to be marked seen (`agent.markSeen { kind, id }`); every other state sends nothing.
     * BLOCKED (OXB): CommandApi (protocol/live/Commands.kt, outside this task's write set) has no `markSeen`, and its
     * constructor and LiveStreams' sender are not reachable from the app, so the command can't be sent from here yet.
     */
    fun open(row: AgentRow) {
        markSeenOnOpen(row)?.let { pendingMarkSeen = it }
    }
}
