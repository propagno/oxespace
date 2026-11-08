@file:Suppress("UNUSED_PARAMETER", "unused")

package com.oxespace.mobile.agents

import com.oxespace.mobile.session.LiveRepository
import kotlinx.coroutines.flow.StateFlow

/*
 * 1.5.0 F10 API skeleton (A43), no behaviour; MOB-A43 replaces the TODOs. Test: androidTest AgentsOnDeviceTest.
 */

/** The Agents tab: follows the C5 `agents` stream through [LiveRepository] and sends `agent.markSeen` on a finished row. */
class AgentsViewModel(repository: LiveRepository) {
    val state: StateFlow<AgentsState> get() = TODO("F10 A43")

    fun open(row: AgentRow) {
        TODO("F10 A43")
    }
}
