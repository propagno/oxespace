package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemotePane
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A46 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCRs: docs/roadmap-1.5/ccr-phone-pane-conversation.md (#658, its phone tests 1–7) and ccr-phone-terminal.md (#691)
 * T-P3.3. The store works on its own model ([ConversationItem], [ConversationPage]); mapping the generated
 * `RemotePaneConversationPage` into it is the executor's, like #521's `toAgentRow`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PaneConversationTest {
    private fun item(n: Int, text: String = "message $n") = ConversationItem(id = "native:$n", role = if (n % 2 == 0) "user" else "assistant", text = text)
    private fun page(vararg ids: Int, cursor: String? = null, epoch: Long = 1) = ConversationPage(ids.map { item(it) }, cursor, epoch)

    /** A desktop that answers `pane.conversation` from a script: by cursor, or the newest page for `null`. */
    private class Desk {
        val asked = mutableListOf<String?>()
        var newest: ConversationFetch = ConversationFetch.NoConversation
        val older = mutableMapOf<String, ConversationFetch>()
        var hold: CompletableDeferred<Unit>? = null
        suspend fun fetch(cursor: String?): ConversationFetch {
            asked += cursor
            hold?.await()
            return if (cursor == null) newest else older[cursor] ?: ConversationFetch.Changed(null)
        }
    }

    private fun TestScope.store(desk: Desk) = PaneConversation(scope = this, fetch = desk::fetch)
    private fun ids(store: PaneConversation) = store.state.value.items.map { it.id }

    // 1 and 4: the toggle follows the field; an older desktop has no field and no toggle.
    @Test
    fun theToggleShowsOnlyWhenThePaneSaysItHasAConversation() {
        val pane = RemotePane(id = "p1", title = "claude", kind = "agent", agent = "claude", phoneWrite = false)
        assertTrue(showsConversationToggle(pane.copy(conversation = true)))
        assertFalse(showsConversationToggle(pane.copy(conversation = false)))
        assertFalse(showsConversationToggle(pane))
    }

    // 2: Load earlier walks to cursor null in page order, with no duplicate ids, never sorted across pages.
    @Test
    fun loadEarlierWalksBackInPageOrderWithNoDuplicates() = runTest {
        val desk = Desk().apply {
            older["c1"] = ConversationFetch.Page(page(4, 5, 6, cursor = "c2"))
            older["c2"] = ConversationFetch.Page(page(1, 2, 3, 4, cursor = null))
        }
        val store = store(desk)
        store.onSnapshot(page(7, 8, 9, cursor = "c1"))
        store.loadEarlier(); runCurrent()
        store.loadEarlier(); runCurrent()
        assertEquals((1..9).map { "native:$it" }, ids(store))
        assertNull(store.state.value.olderCursor)
        assertEquals(listOf<String?>("c1", "c2"), desk.asked)
    }

    // 3a: a new session is not "unavailable": replace, and show the marker line.
    @Test
    fun aNewSessionReplacesTheItemsAndShowsTheMarkerLineNotTheNotice() = runTest {
        val desk = Desk().apply { newest = ConversationFetch.Page(page(1, 2, epoch = 2)) }
        val store = store(desk)
        store.onSnapshot(page(10, 11, epoch = 1))
        store.onChanged(); runCurrent()
        assertEquals(listOf("native:1", "native:2"), ids(store))
        assertTrue(store.state.value.newConversation)
        assertFalse(store.state.value.unavailable)

        // The same through Load earlier with an old handle: `conversation-changed` with `reason: 'new-session'`.
        val other = Desk().apply { newest = ConversationFetch.Page(page(20, epoch = 3)); older["old"] = ConversationFetch.Changed("new-session") }
        val again = store(other)
        again.onSnapshot(page(5, cursor = "old", epoch = 2))
        again.loadEarlier(); runCurrent()
        assertEquals(listOf("native:20"), ids(again))
        assertTrue(again.state.value.newConversation)
        assertFalse(again.state.value.unavailable)
    }

    // 3b: rewritten, or no or unknown reason: reload once, then the Notice if it fails again.
    @Test
    fun aRewrittenConversationReloadsOnceThenShowsTheNotice() = runTest {
        for (reason in listOf("rewritten", null, "something-new")) {
            val desk = Desk().apply { older["c1"] = ConversationFetch.Changed(reason); newest = ConversationFetch.Page(page(30, 31, cursor = "c9")) }
            val store = store(desk)
            store.onSnapshot(page(30, cursor = "c1"))
            store.loadEarlier(); runCurrent()
            assertEquals("$reason", listOf("native:30", "native:31"), ids(store))
            assertFalse("$reason", store.state.value.unavailable)

            // It fails again: now the Notice.
            desk.older["c9"] = ConversationFetch.Changed(reason)
            desk.newest = ConversationFetch.Changed(reason)
            store.loadEarlier(); runCurrent()
            assertTrue("$reason", store.state.value.unavailable)
        }
    }

    @Test
    fun noConversationShowsTheNotice() = runTest {
        val store = store(Desk())
        store.onSnapshot(page(1))
        store.onChanged(); runCurrent()
        assertTrue(store.state.value.unavailable)
    }

    // 5: a changed event fetches the newest page; known ids replace in place, new ids append.
    @Test
    fun aChangedEventMergesTheNewestPageById() = runTest {
        val desk = Desk().apply {
            newest = ConversationFetch.Page(ConversationPage(listOf(item(2, "grown"), item(3), item(4)), cursor = "c1", epoch = 1))
        }
        val store = store(desk)
        store.onSnapshot(page(1, 2, cursor = "c0"))
        store.onChanged(); runCurrent()
        assertEquals(listOf("native:1", "native:2", "native:3", "native:4"), ids(store))
        assertEquals("grown", store.state.value.items[1].text)
        // The Latest chip counts the two new ids.
        assertEquals(2, store.state.value.newCount)
        store.seen()
        assertEquals(0, store.state.value.newCount)
    }

    // 5: coalescing, while a fetch is in flight, further events queue at most one more.
    @Test
    fun eventsDuringAFetchQueueAtMostOneMore() = runTest {
        val desk = Desk().apply { newest = ConversationFetch.Page(page(1, 2)); hold = CompletableDeferred() }
        val store = store(desk)
        store.onSnapshot(page(1))
        store.onChanged(); runCurrent()
        repeat(5) { store.onChanged() }
        runCurrent()
        assertEquals(1, desk.asked.size)
        desk.hold!!.complete(Unit)
        runCurrent()
        assertEquals(2, desk.asked.size)
        assertEquals(listOf("native:1", "native:2"), ids(store))
    }

    // 6: no overlap replaces the held items; Load earlier walks back from there; the chip has no count after a gap.
    @Test
    fun aNewestPageWithNoOverlapReplacesTheItemsAndLoadEarlierWalksBackFromIt() = runTest {
        val desk = Desk().apply {
            newest = ConversationFetch.Page(page(60, 61, cursor = "c59"))
            older["c59"] = ConversationFetch.Page(page(58, 59, cursor = null))
        }
        val store = store(desk)
        store.onSnapshot(page(1, 2, cursor = "c0"))
        store.onChanged(); runCurrent()
        assertEquals(listOf("native:60", "native:61"), ids(store))
        assertNull(store.state.value.newCount)
        assertFalse(store.state.value.newConversation)
        store.loadEarlier(); runCurrent()
        assertEquals(listOf("native:58", "native:59", "native:60", "native:61"), ids(store))
    }

    // 7: follow(atBottom).
    @Test
    fun itFollowsNewItemsOnlyAtTheBottom() = runTest {
        val store = store(Desk())
        assertTrue(store.follow(atBottom = true))
        assertFalse(store.follow(atBottom = false))
    }
}
