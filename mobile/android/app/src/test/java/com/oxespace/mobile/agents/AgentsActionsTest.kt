package com.oxespace.mobile.agents

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A43 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-phone-agents-steer.md (#689) T-P2.1: where a tap leads, and when `agent.markSeen` is sent.
 */
class AgentsActionsTest {
    private val now = 1_000_000_000L

    private fun row(kind: String, id: String, state: String, request: AgentRequest? = null) =
        AgentRow(kind = kind, id = id, state = state, provider = "claude", title = "Row $id", since = now, rev = 1, request = request)

    @Test
    fun `a conversation with an answerable request goes straight to that request`() {
        val login = row("thread", "t-login", "needs-you", AgentRequest("r-1", "Run npm test", "medium", answerable = true))
        assertEquals(AgentTapTarget.Request(threadId = "t-login", requestId = "r-1"), tapTarget(login))
    }

    @Test
    fun `a request answerable only on the computer, or on a row that isn't a conversation, opens the row`() {
        val onComputer = row("thread", "t-2", "needs-you", AgentRequest("r-2", "Edit settings", "high", answerable = false))
        assertEquals(AgentTapTarget.Row(AgentKey("thread", "t-2")), tapTarget(onComputer))
        val pane = row("pane", "p-3", "needs-you", AgentRequest("r-3", "Continue?", null, answerable = true))
        assertEquals(AgentTapTarget.Row(AgentKey("pane", "p-3")), tapTarget(pane))
    }

    @Test
    fun `opening a finished row marks it seen, and every other state sends nothing`() {
        assertEquals(AgentKey("delegation", "d-2"), markSeenOnOpen(row("delegation", "d-2", "finished")))
        for (state in listOf("needs-you", "failed", "working", "idle", "stopped", "dreaming")) {
            assertNull(state, markSeenOnOpen(row("thread", "t", state)))
        }
    }
}
