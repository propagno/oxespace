package com.oxespace.mobile.ui

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.live.FakeDesktop
import com.oxespace.mobile.protocol.RemoteCommand
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.live.PaneConversation
import com.oxespace.mobile.protocol.live.PaneConversationState
import com.oxespace.mobile.session.LiveRepository
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frozen acceptance test for 1.5.0 A46 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCRs: docs/roadmap-1.5/ccr-phone-pane-conversation.md (#658) and ccr-phone-terminal.md (#691) T-P3.3, the emulator
 * test: the `paneConversation` stream and the `pane.conversation` command through the app's real streams on an
 * Android runtime, against the in-test fake desktop. A `changed` event carries no content; the phone fetches.
 */
@RunWith(AndroidJUnit4::class)
class PaneConversationOnDeviceTest {
    private val desktop = FakeDesktop()

    @After
    fun tearDown() = desktop.close()

    private fun json(text: String): JsonElement = RemoteFrames.json.parseToJsonElement(text)

    private fun message(n: Int, text: String = "message $n") =
        """{"seq":$n,"item":{"type":"message","id":"native:$n","role":"${if (n % 2 == 0) "user" else "assistant"}","text":"$text"}}"""

    private fun page(vararg items: String, cursor: String? = "c-old", epoch: Int = 1) =
        json("""{"agent":"claude","title":"Fix login","items":[${items.joinToString(",")}],"cursor":${cursor?.let { "\"$it\"" } ?: "null"},"epoch":$epoch}""")

    private fun open(): PaneConversation {
        desktop.serve(RemoteSubscription.PANE_CONVERSATION) { page(message(1), message(2)) }
        val repository = LiveRepository(desktop.streams)
        val conversation = repository.openPaneConversation("pane-1")
        desktop.connect()
        desktop.settle()
        return conversation
    }

    private fun waitFor(conversation: PaneConversation, done: (PaneConversationState) -> Boolean): PaneConversationState =
        runBlocking { withTimeout(10_000) { conversation.state.first(done) } }

    private fun waitUntil(done: () -> Boolean) = runBlocking { withTimeout(10_000) { while (!done()) delay(20) } }

    private fun ids(state: PaneConversationState) = state.items.map { it.id }

    @Test
    fun opensWithOneSubscribeToThatPaneAndShowsTheNewestPage() {
        val conversation = open()
        val subscribe = desktop.subscribes(RemoteSubscription.PANE_CONVERSATION).single()
        assertEquals("pane-1", subscribe.target)
        assertEquals(listOf("native:1", "native:2"), ids(waitFor(conversation) { it.items.size == 2 }))
        // Opening is the subscribe alone: no fetch until something changes.
        assertTrue(desktop.commands(RemoteCommand.PANE_CONVERSATION).isEmpty())
    }

    @Test
    fun aChangedEventMakesOneFetchOfTheNewestPageAndMergesItById() {
        val conversation = open()
        waitFor(conversation) { it.items.size == 2 }
        desktop.answer(RemoteCommand.PANE_CONVERSATION) { page(message(2, "message 2, grown"), message(3)) }

        desktop.event(RemoteSubscription.PANE_CONVERSATION, target = "pane-1", data = json("""{"changed":true}"""))
        val merged = waitFor(conversation) { it.items.size == 3 }
        desktop.settle()

        val fetches = desktop.commands(RemoteCommand.PANE_CONVERSATION)
        assertEquals(1, fetches.size)
        assertEquals("pane-1", fetches.single().args["paneId"]?.jsonPrimitive?.content)
        assertFalse("the newest page is fetched without a cursor", fetches.single().args.containsKey("cursor"))
        assertEquals(listOf("native:1", "native:2", "native:3"), ids(merged))
        assertEquals("message 2, grown", merged.items[1].text)
    }

    @Test
    fun aBurstOfChangesWhileAFetchIsInFlightMakesAtMostOneMoreFetch() {
        val conversation = open()
        waitFor(conversation) { it.items.size == 2 }
        val release = CountDownLatch(1)
        desktop.answer(RemoteCommand.PANE_CONVERSATION) {
            release.await(5, TimeUnit.SECONDS)
            page(message(1), message(2), message(3))
        }
        // The first fetch reaches the desktop, which is slow to answer it; four more changes arrive meanwhile.
        desktop.event(RemoteSubscription.PANE_CONVERSATION, target = "pane-1", data = json("""{"changed":true}"""))
        waitUntil { desktop.commands(RemoteCommand.PANE_CONVERSATION).size == 1 }
        repeat(4) { conversation.onChanged() }
        release.countDown()
        // One fetch in flight, at most one more queued: exactly two, and no third after a while.
        waitUntil { desktop.commands(RemoteCommand.PANE_CONVERSATION).size == 2 }
        waitFor(conversation) { it.items.size == 3 }
        Thread.sleep(500)
        desktop.settle()
        assertEquals(2, desktop.commands(RemoteCommand.PANE_CONVERSATION).size)
    }
}
