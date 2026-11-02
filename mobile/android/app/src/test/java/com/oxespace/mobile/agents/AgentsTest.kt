package com.oxespace.mobile.agents

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentsTest {
    private val now = 1_000_000_000L
    private val rows = sampleAgents(now)

    @Test
    fun `the list is ordered by state precedence, then longest in that state, then by key`() {
        val order = visibleRows(rows.shuffled(java.util.Random(7)), AgentFilter.ALL).map { it.id }
        assertEquals(listOf("t-login", "p-3", "w-7", "t-docs", "d-2", "p-1", "t-old"), order)
    }

    @Test
    fun `filters keep only their rows`() {
        assertEquals(listOf("t-login", "p-3"), visibleRows(rows, AgentFilter.NEEDS_YOU).map { it.id })
        assertEquals(listOf("t-login", "t-docs", "t-old"), visibleRows(rows, AgentFilter.CONVERSATIONS).map { it.id })
        assertEquals(listOf("p-3", "p-1"), visibleRows(rows, AgentFilter.TERMINALS).map { it.id })
        assertEquals(listOf("w-7", "d-2"), visibleRows(rows, AgentFilter.TASKS).map { it.id })
    }

    @Test
    fun `an unknown state reads as unknown and sorts last, an unknown kind is never shown`() {
        val store = AgentsStore()
        store.onSnapshot(listOf(AgentRow("thread", "x", "dreaming", "claude", "New state", now), AgentRow("robot", "y", "working", "other", "New kind", now)), emptyList())
        val shown = store.state.value.rows
        assertEquals(listOf("x"), shown.map { it.id })
        assertEquals(AgentState.UNKNOWN, stateOf(shown.single()))
    }

    @Test
    fun `only a conversation's answerable request is answered here, and it opens in that conversation`() {
        val login = rows.first { it.id == "t-login" }
        assertEquals(setOf(RowAction.RESPOND, RowAction.OPEN), rowActions(login))
        assertEquals(AgentTapTarget.Request(threadId = "t-login", requestId = "r-1"), tapTarget(login))
        val pane = rows.first { it.id == "p-3" }
        assertEquals(setOf(RowAction.OPEN), rowActions(pane))
        assertEquals(AgentTapTarget.Row(AgentKey("pane", "p-3")), tapTarget(pane))
    }

    @Test
    fun `opening a finished row marks it seen, other states send nothing`() {
        val source = FakeAgentsSource(now)
        val model = AgentsViewModel(source)
        model.open(rows.first { it.id == "d-2" })
        model.open(rows.first { it.id == "t-docs" })
        assertEquals(listOf(AgentKey("delegation", "d-2")), source.seen)
        assertNull(markSeenOnOpen(rows.first { it.id == "w-7" }))
    }

    @Test
    fun `events upsert and remove by kind and id, the same id under two kinds is two rows`() {
        val store = AgentsStore()
        store.onSnapshot(listOf(AgentRow("pane", "1", "idle", "claude", "Pane", now), AgentRow("thread", "1", "working", "codex", "Conversation", now)), emptyList())
        store.onEvent(upsert = listOf(AgentRow("thread", "1", "finished", "codex", "Conversation", now + 5)), removed = listOf(AgentKey("pane", "1")), unavailable = listOf("work"))
        val state = store.state.value
        assertEquals(listOf(AgentKey("thread", "1")), state.rows.map { it.key })
        assertEquals("finished", state.rows.single().state)
        assertEquals(listOf("work"), state.unavailable)
        assertTrue(state.loaded)
    }

    @Test
    fun `nothing loaded until the first snapshot`() {
        assertFalse(AgentsStore().state.value.loaded)
    }
}
