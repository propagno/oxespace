package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteEventFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteSnapshotFrame
import com.oxespace.mobile.protocol.RemoteSubscribeFrame
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.RemoteUnsubscribeFrame
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 CR-34 (HML-F10-1), the phone side, phase F10. Written by the planner; the executor
 * must not edit it. "Show on phone" is a desktop-only switch per pane. A pane switched off leaves the phone entirely:
 * - it's gone from the workspaces list;
 * - an open terminal or conversation ends: the desktop sends an `error` frame naming the subscription, with `not-found`
 *   and `reason: "pane-hidden"` (C5, additive: `RemoteErrorFrame.subscription?`);
 * - nothing of the pane stays on screen, the last frame included (DESIGN);
 * - the stream is never asked for again: no unsubscribe, no retry, no resubscribe after a reconnect.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PaneHiddenTest {
    private val sent = mutableListOf<RemoteFrame>()
    private var ids = 0
    private val hub = SubscriptionHub(send = { sent += it }, newId = { "id-${++ids}" })
    private val esc = "\u001B"

    private fun subscribeOf(topic: RemoteSubscription) = sent.filterIsInstance<RemoteSubscribeFrame>().last { it.topic == topic }
    private fun hidden(name: String) = RemoteErrorFrame(subscription = name, code = RemoteErrorCode.NOT_FOUND, reason = "pane-hidden")

    private fun terminalPage(data: String): JsonElement =
        RemoteFrames.json.parseToJsonElement("""{"data":${JsonPrimitive(data)},"truncated":false}""")

    /** A terminal followed through the hub, with a screen on it. */
    private fun openTerminal(): TerminalBuffer {
        val terminal = TerminalBuffer()
        hub.follow(RemoteSubscription.TERMINAL, "pane-1", terminal)
        hub.onConnected()
        hub.onFrame(RemoteAckFrame(id = subscribeOf(RemoteSubscription.TERMINAL).id, subscription = "s-term"))
        hub.onFrame(RemoteSnapshotFrame("s-term", 1, 1, terminalPage("$ deploy --token=[hidden]\r\nDeploying…")))
        return terminal
    }

    @Test
    fun aHiddenPaneEndsItsOpenTerminalAndNothingOfItStaysOnScreen() {
        val terminal = openTerminal()
        assertTrue(terminal.output.contains("Deploying"))
        assertTrue(hub.onFrame(hidden("s-term")))
        assertTrue(terminal.hiddenOnDesktop)
        assertEquals("", terminal.output)
        assertTrue(terminal.lines().all { it.text.isEmpty() })
    }

    @Test
    fun anEndedStreamIsNeverAskedForAgainNotEvenAfterAReconnect() {
        openTerminal()
        hub.onFrame(hidden("s-term"))
        assertFalse("no unsubscribe for a stream the desktop ended", sent.any { it is RemoteUnsubscribeFrame })
        val before = sent.filterIsInstance<RemoteSubscribeFrame>().size
        hub.onDisconnected()
        hub.onConnected()
        assertEquals("no resubscribe, no retry loop", before, sent.filterIsInstance<RemoteSubscribeFrame>().size)
    }

    @Test
    fun framesThatStillArriveForTheEndedStreamAreIgnored() {
        val terminal = openTerminal()
        hub.onFrame(hidden("s-term"))
        hub.onFrame(RemoteEventFrame("s-term", 2, 1, terminalPage("late output")))
        assertEquals("", terminal.output)
    }

    @Test
    fun anErrorNamingAnotherSubscriptionLeavesThisOneAlone() {
        val terminal = openTerminal()
        assertFalse(hub.onFrame(hidden("s-someone-else")))
        assertFalse(terminal.hiddenOnDesktop)
        assertTrue(terminal.output.contains("Deploying"))
    }

    @Test
    fun theOtherEndReasonsStillReadAsARefusalNotAsHidden() {
        val terminal = openTerminal()
        hub.onFrame(RemoteErrorFrame(subscription = "s-term", code = RemoteErrorCode.NOT_FOUND))
        assertFalse(terminal.hiddenOnDesktop)
        // The stream is still ended once: no retry loop.
        val before = sent.filterIsInstance<RemoteSubscribeFrame>().size
        hub.onDisconnected()
        hub.onConnected()
        assertEquals(before, sent.filterIsInstance<RemoteSubscribeFrame>().size)
    }

    @Test
    fun aHiddenPaneEndsItsOpenConversationAndClearsIt() = runTest {
        val conversation = PaneConversation(scope = this, fetch = { ConversationFetch.NoConversation })
        conversation.onSnapshot(ConversationPage(listOf(ConversationItem("native:1", "user", "deploy it")), cursor = null, epoch = 1))
        conversation.onHidden()
        assertTrue(conversation.state.value.hiddenOnDesktop)
        assertTrue(conversation.state.value.items.isEmpty())
        // Hidden is its own Notice, not "unavailable" (that one offers Show the screen, which is gone too).
        assertFalse(conversation.state.value.unavailable)
    }

    @Test
    fun theHiddenPaneIsGoneFromTheWorkspacesList() {
        val store = workspacesStore()
        val ws = { panes: String -> RemoteFrames.json.parseToJsonElement("""{"workspaces":[{"id":"ws1","name":"proj","active":true,"panes":[$panes]}]}""") }
        val p1 = """{"id":"p1","title":"Build","kind":"terminal","phoneWrite":false}"""
        val p2 = """{"id":"p2","title":"claude","kind":"agent","phoneWrite":false}"""
        store.onSnapshot(listOf(ws("$p1,$p2")))
        store.onEvent(ws(p2))
        assertEquals(listOf("p2"), store.items.value.single().panes.map { it.id })
    }
}
