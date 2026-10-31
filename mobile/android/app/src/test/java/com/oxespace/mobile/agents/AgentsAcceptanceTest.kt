package com.oxespace.mobile.agents

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * S7.4 acceptance, written before the code (charter "Ready" gate): RED until the S7.1 CCR (#354) lands and S7.4 is built.
 * Each test is one rule from docs/design/s7-mission-control.md §8 / §5.3 / §11.2.
 */
class AgentsAcceptanceTest {
    private fun row(id: String, kind: AgentKind, state: AgentState, since: Long, request: AgentRequestDraft? = null, canInterrupt: Boolean = false) =
        AgentRowDraft(
            id = id, kind = kind, state = state, since = since, title = id, provider = "claude", workspaceName = "oxespace",
            threadId = if (kind == AgentKind.CONVERSATION) id.substringAfter(':') else null,
            paneId = if (kind == AgentKind.PANE) id.substringAfter(':') else null,
            request = request, canInterrupt = canInterrupt,
        )

    private val asking = AgentRequestDraft("t-1", "r-1", "Run npm test", risk = "medium", answerable = true)
    private val rows = listOf(
        row("conversation:t-3", AgentKind.CONVERSATION, AgentState.IDLE, since = 10),
        row("conversation:t-2", AgentKind.CONVERSATION, AgentState.WORKING, since = 50, canInterrupt = true),
        row("pane:p-1", AgentKind.PANE, AgentState.NEEDS_YOU, since = 300),
        row("conversation:t-1", AgentKind.CONVERSATION, AgentState.NEEDS_YOU, since = 100, request = asking),
        row("work:w-1", AgentKind.WORK, AgentState.FAILED, since = 200),
        row("pane:p-2", AgentKind.PANE, AgentState.UNKNOWN, since = 5),
    )

    @Test
    fun allShowsEveryRowInTheSharedOrderLongestWaitFirst() {
        assertEquals(
            listOf("conversation:t-1", "pane:p-1", "work:w-1", "conversation:t-2", "conversation:t-3", "pane:p-2"),
            visibleRows(rows, AgentFilter.ALL).map { it.id },
        )
    }

    @Test
    fun theChipsFilterByStateOrKind() {
        assertEquals(listOf("conversation:t-1", "pane:p-1"), visibleRows(rows, AgentFilter.NEEDS_YOU).map { it.id })
        assertEquals(listOf("conversation:t-1", "conversation:t-2", "conversation:t-3"), visibleRows(rows, AgentFilter.CONVERSATIONS).map { it.id })
        assertEquals(listOf("pane:p-1", "pane:p-2"), visibleRows(rows, AgentFilter.TERMINALS).map { it.id })
        assertEquals(listOf("work:w-1"), visibleRows(rows, AgentFilter.TASKS).map { it.id })
    }

    @Test
    fun v1ActsOnConversationsOnly() {
        val actions = rows.associate { it.id to rowActions(it) }
        assertEquals(setOf(RowAction.RESPOND, RowAction.OPEN), actions["conversation:t-1"])
        assertEquals(setOf(RowAction.STOP, RowAction.OPEN), actions["conversation:t-2"])
        // A pane that needs the person still opens; it's never stopped or answered from the phone in v1 (§11.2).
        assertEquals(setOf(RowAction.OPEN), actions["pane:p-1"])
        assertEquals(setOf(RowAction.OPEN), actions["work:w-1"])
    }

    @Test
    fun stopOnlyWhereTheDesktopAllowsIt() {
        val running = row("conversation:t-9", AgentKind.CONVERSATION, AgentState.WORKING, since = 1, canInterrupt = false)
        assertFalse(RowAction.STOP in rowActions(running))
    }

    @Test
    fun aRequestOnlyTheComputerCanAnswerOffersNoRespond() {
        val desktopOnly = row("conversation:t-4", AgentKind.CONVERSATION, AgentState.NEEDS_YOU, since = 1, request = asking.copy(answerable = false))
        assertFalse(RowAction.RESPOND in rowActions(desktopOnly))
        assertTrue(RowAction.OPEN in rowActions(desktopOnly))
    }

    @Test
    fun aNeedsYouNotificationGoesStraightToAnAnswerableRequestOtherwiseToTheRow() {
        assertEquals(AgentTapTarget.Request("t-1", "r-1"), tapTarget(rows.first { it.id == "conversation:t-1" }))
        val desktopOnly = row("conversation:t-4", AgentKind.CONVERSATION, AgentState.NEEDS_YOU, since = 1, request = asking.copy(answerable = false))
        assertTrue(tapTarget(desktopOnly) is AgentTapTarget.Row)
        assertEquals(AgentTapTarget.Row("work:w-1"), tapTarget(rows.first { it.id == "work:w-1" }))
        val noThread = row("conversation:t-5", AgentKind.CONVERSATION, AgentState.NEEDS_YOU, since = 1, request = asking.copy(threadId = null))
        assertEquals(AgentTapTarget.Row("conversation:t-5"), tapTarget(noThread))
    }

    @Test
    fun aStateTheDesktopAddsLaterReadsAsUnknown() {
        assertEquals(AgentState.NEEDS_YOU, agentStateOf("needs-you"))
        assertEquals(AgentState.IDLE, agentStateOf("idle"))
        assertEquals(AgentState.UNKNOWN, agentStateOf("paused-by-policy"))
    }

    @Test
    fun theContractIsGeneratedFromProtocolTs() {
        // Red until BACKEND's CCR adds the agents subscription and android:generate commits it.
        val generated = runCatching { Class.forName("com.oxespace.mobile.protocol.RemoteAgentRow") }.isSuccess
        assertTrue("RemoteAgentRow is generated from shared/remote/protocol.ts", generated)
    }
}
