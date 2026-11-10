package com.oxespace.mobile.agents

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A43 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-phone-agents-steer.md (#689) T-P2.1. Ported from #521's AgentsTest, with DESIGN's chips by
 * state (M7.7) in place of the chips by kind, and HML's M10 churn case.
 */
class AgentsStoreTest {
    private val now = 1_000_000_000L

    private fun row(kind: String, id: String, state: String, since: Long, rev: Long, request: AgentRequest? = null) =
        AgentRow(kind = kind, id = id, state = state, provider = "claude", title = "Row $id", since = since, rev = rev, request = request)

    /** One row per state, plus a second needs-you and a second working that has been at it longer. */
    private val rows = listOf(
        row("thread", "t-login", "needs-you", now - 50, 1, AgentRequest("r-1", "Run npm test", "medium", answerable = true)),
        row("pane", "p-3", "needs-you", now - 10, 2),
        row("thread", "t-fail", "failed", now - 40, 3),
        row("work", "w-7", "working", now - 90, 4),
        row("pane", "p-9", "working", now - 20, 5),
        row("thread", "t-docs", "finished", now - 30, 6),
        row("delegation", "d-2", "idle", now - 70, 7),
        row("pane", "p-1", "stopped", now - 60, 8),
        row("thread", "t-old", "dreaming", now - 80, 9),
    )

    @Test
    fun `the list is ordered by state precedence, then longest in that state, then by kind and id`() {
        val order = visibleRows(rows.shuffled(java.util.Random(7)), AgentFilter.ALL).map { it.id }
        assertEquals(listOf("t-login", "p-3", "t-fail", "w-7", "p-9", "t-docs", "d-2", "p-1", "t-old"), order)
    }

    @Test
    fun `the five chips are All, Needs you, Working, Failed and Finished, in that order`() {
        assertEquals(
            listOf(AgentFilter.ALL, AgentFilter.NEEDS_YOU, AgentFilter.WORKING, AgentFilter.FAILED, AgentFilter.FINISHED),
            AgentFilter.entries.toList(),
        )
    }

    @Test
    fun `each chip keeps only its state, and idle, stopped and unknown show under All only`() {
        assertEquals(listOf("t-login", "p-3"), visibleRows(rows, AgentFilter.NEEDS_YOU).map { it.id })
        assertEquals(listOf("w-7", "p-9"), visibleRows(rows, AgentFilter.WORKING).map { it.id })
        assertEquals(listOf("t-fail"), visibleRows(rows, AgentFilter.FAILED).map { it.id })
        assertEquals(listOf("t-docs"), visibleRows(rows, AgentFilter.FINISHED).map { it.id })
        val underAChip = AgentFilter.entries.filter { it != AgentFilter.ALL }.flatMap { visibleRows(rows, it) }.map { it.id }
        for (id in listOf("d-2", "p-1", "t-old")) assertFalse(id, id in underAChip)
    }

    @Test
    fun `each chip's count is the number of rows it shows`() {
        val counts = chipCounts(rows)
        for (filter in AgentFilter.entries) assertEquals(filter.name, visibleRows(rows, filter).size, counts[filter])
        assertEquals(9, counts[AgentFilter.ALL])
        assertEquals(2, counts[AgentFilter.NEEDS_YOU])
    }

    @Test
    fun `an unknown state reads as Not confirmed and sorts last, an unknown kind is never shown`() {
        val store = AgentsStore()
        store.onSnapshot(listOf(row("thread", "x", "dreaming", now, 1), row("robot", "y", "working", now, 2)), emptyList())
        val shown = store.state.value.rows
        assertEquals(listOf("x"), shown.map { it.id })
        assertEquals(AgentState.UNKNOWN, stateOf(shown.single()))
    }

    @Test
    fun `events upsert and remove by kind and id, and the same id under two kinds is two rows`() {
        val store = AgentsStore()
        store.onSnapshot(listOf(row("pane", "1", "idle", now, 1), row("thread", "1", "working", now, 2)), emptyList())
        store.onEvent(upsert = listOf(row("thread", "1", "finished", now + 5, 3)), removed = listOf(AgentRemoval("pane", "1", rev = 4)), unavailable = listOf("work"))
        val state = store.state.value
        assertEquals(listOf(AgentKey("thread", "1")), state.rows.map { it.key })
        assertEquals("finished", state.rows.single().state)
        assertEquals(listOf("work"), state.unavailable)
        assertTrue(state.loaded)
    }

    @Test
    fun `a late or repeated upsert never brings back a removed row nor an older state`() {
        val store = AgentsStore()
        val base = row("thread", "c", "working", now, 10)
        store.onSnapshot(listOf(base), emptyList())
        store.onEvent(upsert = listOf(base.copy(state = "finished", rev = 12)), removed = emptyList(), unavailable = emptyList())
        store.onEvent(upsert = listOf(base.copy(state = "working", rev = 11)), removed = emptyList(), unavailable = emptyList())
        assertEquals("finished", store.state.value.rows.single().state)
        store.onEvent(upsert = emptyList(), removed = listOf(AgentRemoval("thread", "c", rev = 13)), unavailable = emptyList())
        store.onEvent(upsert = listOf(base.copy(state = "finished", rev = 12)), removed = emptyList(), unavailable = emptyList())
        assertTrue(store.state.value.rows.isEmpty())
        store.onEvent(upsert = listOf(base.copy(state = "working", rev = 14)), removed = emptyList(), unavailable = emptyList())
        assertEquals("working", store.state.value.rows.single().state)
        store.onEvent(upsert = emptyList(), removed = listOf(AgentRemoval("thread", "c", rev = 13)), unavailable = emptyList())
        assertEquals(1, store.state.value.rows.size)
    }

    @Test
    fun `a resubscribe snapshot replaces all`() {
        // N1: after a reconnect the desktop sends a fresh snapshot. It replaces rows and tombstones alike, so nothing
        // held from before the drop survives and nothing is counted twice.
        val store = AgentsStore()
        val held = row("pane", "p", "idle", now, 50)
        store.onSnapshot(listOf(held, row("thread", "gone", "working", now, 51)), emptyList())
        store.onEvent(upsert = emptyList(), removed = listOf(AgentRemoval("pane", "p", rev = 60)), unavailable = emptyList())
        store.onSnapshot(listOf(held.copy(rev = 5)), listOf("work"))
        assertEquals(listOf(AgentKey("pane", "p")), store.state.value.rows.map { it.key })
        assertEquals(listOf("work"), store.state.value.unavailable)
    }

    @Test
    fun `nothing is loaded until the first snapshot`() {
        assertFalse(AgentsStore().state.value.loaded)
    }

    /** The stated sort key: state precedence, then `since`, then kind and id. */
    private fun sortKey(row: AgentRow) = listOf(stateOf(row).ordinal.toLong(), row.since, row.kind.hashCode().toLong(), row.id.hashCode().toLong())

    @Test
    fun `under churn only rows whose key changed move`() {
        // HML M10: 20 agents, 10 state changes a second for 30 s, seeded. Over every snapshot of the list, the order is
        // the stated one, and the rows whose sort key didn't change keep their order relative to each other.
        val random = java.util.Random(1_505)
        val states = listOf("needs-you", "failed", "working", "finished", "idle", "stopped")
        val kinds = listOf("thread", "pane", "work", "delegation")
        val store = AgentsStore()
        var rev = 1L
        val start = List(20) { i -> row(kinds[i % kinds.size], "a-$i", states[i % states.size], now - i * 1_000L, rev++) }
        store.onSnapshot(start, emptyList())
        var before = visibleRows(store.state.value.rows, AgentFilter.ALL)
        repeat(300) { step ->
            val at = now + (step + 1) * 100L
            val current = store.state.value.rows.associateBy { it.key }
            val chosen = current.values.sortedBy { it.id }[random.nextInt(20)]
            val next = states[random.nextInt(states.size)]
            val changed = chosen.copy(state = next, since = if (next == chosen.state) chosen.since else at, rev = rev++)
            store.onEvent(upsert = listOf(changed), removed = emptyList(), unavailable = emptyList())

            val after = visibleRows(store.state.value.rows, AgentFilter.ALL)
            assertEquals("step $step: the stated order", after.sortedWith(compareBy<AgentRow>({ stateOf(it).ordinal }, { it.since }, { it.kind }, { it.id })), after)
            val unchanged = before.filter { old -> after.any { it.key == old.key && sortKey(it) == sortKey(old) } }.map { it.key }
            assertEquals("step $step: no row moved without its own key changing", unchanged, after.map { it.key }.filter { it in unchanged })
            before = after
        }
        assertEquals(20, store.state.value.rows.size)
    }
}
