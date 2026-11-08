package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteSubscribeFrame
import com.oxespace.mobile.protocol.RemoteSubscription
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A45 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCRs: docs/roadmap-1.5/ccr-phone-terminal.md (#691) T-P3.2 and ccr-f10-c5-backend.md (#706) BE-A45-flag, with F1:
 * a desktop released before F10 refuses a subscribe with an unknown key as `malformed` (connection.ts:215), so the
 * phone sends `snapshotOnly` only on a session whose hello listed `"terminal.snapshotOnly"` in `features`.
 */
class SubscriptionHubFeaturesTest {
    private val sent = mutableListOf<RemoteFrame>()
    private var ids = 0
    private val hub = SubscriptionHub(send = { sent += it }, newId = { "id-${++ids}" })

    private object Quiet : StreamListener {
        override fun onSnapshot(pages: List<JsonElement>) {}
        override fun onEvent(data: JsonElement) {}
    }

    private fun subscribes() = sent.filterIsInstance<RemoteSubscribeFrame>().associateBy { it.topic }

    private fun followAll() {
        hub.follow(RemoteSubscription.TERMINAL, "pane-1", Quiet)
        hub.follow(RemoteSubscription.THREAD, "t-1", Quiet)
        hub.follow(RemoteSubscription.WORKSPACES, null, Quiet)
    }

    @Test
    fun anAdvertisingDesktopGetsTheFlagOnTerminalSubscribesOnly() {
        followAll()
        hub.onConnected(features = setOf("terminal.snapshotOnly", "pane.conversation"))
        val byTopic = subscribes()
        assertEquals(true, byTopic.getValue(RemoteSubscription.TERMINAL).snapshotOnly)
        assertNull(byTopic.getValue(RemoteSubscription.THREAD).snapshotOnly)
        assertNull(byTopic.getValue(RemoteSubscription.WORKSPACES).snapshotOnly)
    }

    @Test
    fun aDesktopThatDidNotAdvertiseItNeverGetsTheFlag() {
        followAll()
        hub.onConnected(features = emptySet())
        for ((topic, frame) in subscribes()) assertNull(topic.wire, frame.snapshotOnly)
        // The same with no features at all, as from a desktop released before F10.
        sent.clear()
        hub.onDisconnected()
        hub.onConnected()
        for ((topic, frame) in subscribes()) assertNull(topic.wire, frame.snapshotOnly)
    }

    @Test
    fun theFlagFollowsEachSessionSoAReconnectToAnOlderDesktopDropsIt() {
        hub.follow(RemoteSubscription.TERMINAL, "pane-1", Quiet)
        hub.onConnected(features = setOf("terminal.snapshotOnly"))
        assertEquals(true, subscribes().getValue(RemoteSubscription.TERMINAL).snapshotOnly)
        sent.clear()
        hub.onDisconnected()
        hub.onConnected(features = emptySet())
        assertNull(subscribes().getValue(RemoteSubscription.TERMINAL).snapshotOnly)
    }
}
