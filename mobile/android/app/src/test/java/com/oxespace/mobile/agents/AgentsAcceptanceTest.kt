package com.oxespace.mobile.agents

import com.oxespace.mobile.protocol.RemoteAgentMarkSeenArgs
import com.oxespace.mobile.protocol.RemoteAgentRow
import com.oxespace.mobile.protocol.RemoteAgentState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** S7.4 acceptance: each test is one rule from docs/design/s7-mission-control.md §8 / §5.3 / §11.2, on #354's rows. */
class AgentsAcceptanceTest {
    private fun row(id: String, kind: String, state: String, since: Long, request: RemoteAgentRow.Request? = null, canInterrupt: Boolean? = null) =
        RemoteAgentRow(
            id = id, kind = kind, state = state, since = since, title = id, provider = "claude", workspaceName = "oxespace",
            threadId = if (kind == "conversation") id.substringAfter(':') else null,
            paneId = if (kind == "pane") id.substringAfter(':') else null,
            request = request, canInterrupt = canInterrupt,
        )

    private val asking = RemoteAgentRow.Request(threadId = "t-1", requestId = "r-1", title = "Run npm test", risk = "medium", answerable = true, more = 0)
    private val rows = listOf(
        row("conversation:t-3", "conversation", "idle", since = 10),
        row("conversation:t-2", "conversation", "working", since = 50, canInterrupt = true),
        row("pane:p-1", "pane", "needs-you", since = 300),
        row("conversation:t-1", "conversation", "needs-you", since = 100, request = asking),
        row("work:w-1", "work", "failed", since = 200),
        row("delegation:d-1", "delegation", "finished", since = 20),
        row("pane:p-2", "pane", "unknown", since = 5),
    )

    @Test
    fun allShowsEveryRowInTheSharedOrderLongestWaitFirst() {
        assertEquals(
            listOf("conversation:t-1", "pane:p-1", "work:w-1", "conversation:t-2", "delegation:d-1", "conversation:t-3", "pane:p-2"),
            visibleRows(rows, AgentFilter.ALL).map { it.id },
        )
    }

    @Test
    fun theChipsFilterByStateOrKind() {
        assertEquals(listOf("conversation:t-1", "pane:p-1"), visibleRows(rows, AgentFilter.NEEDS_YOU).map { it.id })
        assertEquals(listOf("conversation:t-1", "conversation:t-2", "conversation:t-3"), visibleRows(rows, AgentFilter.CONVERSATIONS).map { it.id })
        assertEquals(listOf("pane:p-1", "pane:p-2"), visibleRows(rows, AgentFilter.TERMINALS).map { it.id })
        assertEquals(listOf("work:w-1", "delegation:d-1"), visibleRows(rows, AgentFilter.TASKS).map { it.id })
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
        assertFalse(RowAction.STOP in rowActions(row("conversation:t-9", "conversation", "working", since = 1, canInterrupt = false)))
        assertFalse(RowAction.STOP in rowActions(row("conversation:t-8", "conversation", "working", since = 1, canInterrupt = null)))
        // A pane never stops from the phone, whatever the flag says.
        assertFalse(RowAction.STOP in rowActions(row("pane:p-9", "pane", "working", since = 1, canInterrupt = true)))
    }

    @Test
    fun aRequestOnlyTheComputerCanAnswerOffersNoRespond() {
        val desktopOnly = row("conversation:t-4", "conversation", "needs-you", since = 1, request = asking.copy(answerable = false))
        assertFalse(RowAction.RESPOND in rowActions(desktopOnly))
        assertTrue(RowAction.OPEN in rowActions(desktopOnly))
    }

    @Test
    fun aNeedsYouNotificationGoesStraightToAnAnswerableRequestOtherwiseToTheRow() {
        assertEquals(AgentTapTarget.Request("t-1", "r-1"), tapTarget(rows.first { it.id == "conversation:t-1" }))
        val desktopOnly = row("conversation:t-4", "conversation", "needs-you", since = 1, request = asking.copy(answerable = false))
        assertEquals(AgentTapTarget.Row("conversation:t-4"), tapTarget(desktopOnly))
        assertEquals(AgentTapTarget.Row("work:w-1"), tapTarget(rows.first { it.id == "work:w-1" }))
        val noThread = row("conversation:t-5", "conversation", "needs-you", since = 1, request = asking.copy(threadId = null))
        assertEquals(AgentTapTarget.Row("conversation:t-5"), tapTarget(noThread))
        assertFalse(RowAction.RESPOND in rowActions(noThread))
    }

    @Test
    fun aStateTheDesktopAddsLaterReadsAsUnknownAndSortsWithTheUnknowns() {
        val later = row("conversation:t-6", "conversation", "paused-by-policy", since = 0)
        assertEquals(RemoteAgentState.UNKNOWN, stateOf(later))
        assertEquals(listOf("conversation:t-6", "pane:p-2"), visibleRows(rows + later, AgentFilter.ALL).takeLast(2).map { it.id })
    }

    @Test
    fun openingAFinishedRowMarksItSeenWithTheSinceThePhoneShowed() {
        assertEquals(RemoteAgentMarkSeenArgs("delegation:d-1", observedSince = 20), onActivate(rows.first { it.id == "delegation:d-1" }))
        // Only "finished" is cleared by seen; opening anything else tells the desktop nothing.
        for (id in listOf("conversation:t-1", "conversation:t-2", "pane:p-1", "work:w-1", "conversation:t-3", "pane:p-2")) {
            assertNull(id, onActivate(rows.first { it.id == id }))
        }
    }
}
