package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrames
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The `agents` stream (S7.1, #354): paged snapshot, upserts and removals, and the C5 unknown-value rules. */
class AgentsStoreTest {
    private fun json(text: String) = RemoteFrames.json.parseToJsonElement(text)
    private fun row(id: String, kind: String = "conversation", state: String = "working", since: Long = 1, rev: Long = 1) =
        """{"id":"$id","rev":$rev,"kind":"$kind","state":"$state","since":$since,"title":"$id","workspaceName":"oxespace"}"""

    @Test
    fun aPagedSnapshotJoinsEveryPageAndTakesUnavailableAndTheNudgeFromTheLastOne() {
        val store = AgentsStore()
        assertFalse(store.state.value.loaded)
        store.onSnapshot(listOf(
            json("""{"agents":[${row("conversation:a")},${row("pane:b", "pane")}]}"""),
            json("""{"agents":[${row("work:c", "work")}],"unavailable":["delegation"],"nudgeAfterMs":600000}"""),
        ))
        val state = store.state.value
        assertTrue(state.loaded)
        assertEquals(listOf("conversation:a", "pane:b", "work:c"), state.rows.map { it.id })
        assertEquals(listOf("delegation"), state.unavailable)
        assertEquals(600_000L, state.nudgeAfterMs)
    }

    @Test
    fun aRowOfAKindThisAppDoesNotKnowIsSkippedAndAnUnknownStateIsKept() {
        val store = AgentsStore()
        store.onSnapshot(listOf(json("""{"agents":[${row("robot:x", "robot")},${row("conversation:a", state = "paused-by-policy")}]}""")))
        assertEquals(listOf("conversation:a"), store.state.value.rows.map { it.id })
        store.onEvent(json("""{"upsert":[${row("robot:y", "robot")}]}"""))
        assertEquals(listOf("conversation:a"), store.state.value.rows.map { it.id })
    }

    @Test
    fun eventsUpsertAndRemoveAndReplaceUnavailableOnlyWhenPresent() {
        val store = AgentsStore()
        store.onSnapshot(listOf(json("""{"agents":[${row("conversation:a")},${row("conversation:b")}],"unavailable":["pane"],"nudgeAfterMs":60000}""")))
        store.onEvent(json("""{"upsert":[${row("conversation:a", state = "finished", since = 9, rev = 2)}],"removed":["conversation:b"]}"""))
        var state = store.state.value
        assertEquals(listOf("conversation:a"), state.rows.map { it.id })
        assertEquals("finished", state.rows.single().state)
        assertEquals(listOf("pane"), state.unavailable)
        // Events never carry the nudge: it stays what the last snapshot said.
        assertEquals(60_000L, state.nudgeAfterMs)
        store.onEvent(json("""{"unavailable":[]}"""))
        state = store.state.value
        assertEquals(emptyList<String>(), state.unavailable)
    }

    @Test
    fun anUpsertAppliesOnlyWhenItsRevIsHigherThanTheRowHeld() {
        val store = AgentsStore()
        store.onSnapshot(listOf(json("""{"agents":[${row("conversation:a", state = "working", rev = 5)}]}""")))
        // A late event (older rev) and a repeated one (same rev) never bring the row back.
        store.onEvent(json("""{"upsert":[${row("conversation:a", state = "needs-you", rev = 4)}]}"""))
        store.onEvent(json("""{"upsert":[${row("conversation:a", state = "idle", rev = 5)}]}"""))
        assertEquals("working", store.state.value.rows.single().state)
        store.onEvent(json("""{"upsert":[${row("conversation:a", state = "finished", rev = 6)}]}"""))
        assertEquals("finished", store.state.value.rows.single().state)
        // A row the phone doesn't hold yet is applied whatever its rev.
        store.onEvent(json("""{"upsert":[${row("pane:b", "pane", rev = 1)}]}"""))
        assertEquals(listOf("conversation:a", "pane:b"), store.state.value.rows.map { it.id })
    }

    @Test
    fun aRemovalAlwaysAppliesAndASnapshotResetsTheRevs() {
        val store = AgentsStore()
        store.onSnapshot(listOf(json("""{"agents":[${row("conversation:a", rev = 9)}]}""")))
        store.onEvent(json("""{"removed":["conversation:a"]}"""))
        assertEquals(emptyList<String>(), store.state.value.rows.map { it.id })
        // After a desktop restart (new epoch) the snapshot starts revs over: a lower rev than before is the truth now.
        store.onSnapshot(listOf(json("""{"agents":[${row("conversation:a", state = "idle", rev = 9)}]}""")))
        store.onSnapshot(listOf(json("""{"agents":[${row("conversation:a", state = "working", rev = 1)}]}""")))
        assertEquals("working", store.state.value.rows.single().state)
        store.onEvent(json("""{"upsert":[${row("conversation:a", state = "finished", rev = 2)}]}"""))
        assertEquals("finished", store.state.value.rows.single().state)
    }

    @Test
    fun aFreshSnapshotReplacesEverythingIncludingATurnedOffNudge() {
        val store = AgentsStore()
        store.onSnapshot(listOf(json("""{"agents":[${row("conversation:a")}],"nudgeAfterMs":60000}""")))
        store.onSnapshot(listOf(json("""{"agents":[${row("conversation:z")}]}""")))
        assertEquals(listOf("conversation:z"), store.state.value.rows.map { it.id })
        assertNull(store.state.value.nudgeAfterMs)
    }

    @Test
    fun aBadFrameNeverBreaksTheList() {
        val store = AgentsStore()
        store.onSnapshot(listOf(json("""{"agents":[${row("conversation:a")}]}""")))
        store.onEvent(json("""{"upsert":"nonsense"}"""))
        assertEquals(listOf("conversation:a"), store.state.value.rows.map { it.id })
    }
}
