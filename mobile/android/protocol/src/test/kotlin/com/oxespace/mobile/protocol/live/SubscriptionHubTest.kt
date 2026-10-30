package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteEventFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteSnapshotFrame
import com.oxespace.mobile.protocol.RemoteSubscribeFrame
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.RemoteUnsubscribeFrame
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SubscriptionHubTest {
    private val sent = mutableListOf<RemoteFrame>()
    private var ids = 0
    private val hub = SubscriptionHub(send = { sent += it }, newId = { "id-${++ids}" })

    /** Records what the stream received, as text. */
    private class Recorder : StreamListener {
        val log = mutableListOf<String>()
        override fun onSnapshot(pages: List<JsonElement>) { log += "snapshot:" + pages.joinToString("+") { (it as JsonPrimitive).content } }
        override fun onEvent(data: JsonElement) { log += "event:" + (data as JsonPrimitive).content }
        override fun onRefused(code: RemoteErrorCode) { log += "refused:${code.wire}" }
    }

    private fun text(value: String) = JsonPrimitive(value)
    private fun lastSubscribe() = sent.filterIsInstance<RemoteSubscribeFrame>().last()
    private fun ack(name: String) = hub.onFrame(RemoteAckFrame(id = lastSubscribe().id, subscription = name))
    private fun snapshot(name: String, seq: Long, data: String, cursor: String? = null, page: RemoteSnapshotFrame.Page? = null) =
        hub.onFrame(RemoteSnapshotFrame(name, seq, 1, text(data), cursor, page))
    private fun event(name: String, seq: Long, data: String, cursor: String? = null) = hub.onFrame(RemoteEventFrame(name, seq, 1, text(data), cursor))

    @Test
    fun subscribesOnceConnectedAndDeliversSnapshotThenEvents() {
        val recorder = Recorder()
        hub.follow(RemoteSubscription.THREAD, "t-1", recorder)
        assertTrue("nothing is sent before the session is ready", sent.isEmpty())
        hub.onConnected()
        assertEquals(RemoteSubscribeFrame(id = "id-1", topic = RemoteSubscription.THREAD, target = "t-1"), lastSubscribe())
        ack("s1")
        snapshot("s1", 1, "A", cursor = "e:1")
        event("s1", 2, "B", cursor = "e:2")
        event("s1", 3, "C", cursor = "e:3")
        assertEquals(listOf("snapshot:A", "event:B", "event:C"), recorder.log)
    }

    @Test
    fun resumesFromTheLastCursorAfterReconnecting() {
        val recorder = Recorder()
        hub.follow(RemoteSubscription.TERMINAL, "pane-1", recorder)
        hub.onConnected()
        ack("s1")
        snapshot("s1", 1, "A", cursor = "10")
        event("s1", 2, "B", cursor = "12")
        hub.onDisconnected()
        // A frame for the old name after the drop is ignored, not applied twice.
        assertFalse(event("s1", 3, "late", cursor = "13"))
        hub.onConnected()
        assertEquals("12", lastSubscribe().cursor)
        ack("s9")
        // The gateway sends what came after the cursor; the new stream numbers its frames afresh.
        event("s9", 1, "C", cursor = "14")
        assertEquals(listOf("snapshot:A", "event:B", "event:C"), recorder.log)
    }

    @Test
    fun aGapMakesItAskAgainFromTheLastPointApplied() {
        val recorder = Recorder()
        hub.follow(RemoteSubscription.THREAD, "t-1", recorder)
        hub.onConnected()
        ack("s1")
        snapshot("s1", 1, "A", cursor = "e:1")
        event("s1", 2, "B", cursor = "e:2")
        event("s1", 4, "D", cursor = "e:4")
        assertEquals("the gapped event is not applied", listOf("snapshot:A", "event:B"), recorder.log)
        assertEquals(RemoteUnsubscribeFrame(id = "id-2", subscription = "s1"), sent[sent.size - 2])
        assertEquals("e:2", lastSubscribe().cursor)
    }

    @Test
    fun appliesAPagedSnapshotOnlyWhenItsLastPageArrives() {
        val recorder = Recorder()
        hub.follow(RemoteSubscription.TERMINAL, "pane-1", recorder)
        hub.onConnected()
        ack("s1")
        snapshot("s1", 1, "A", page = RemoteSnapshotFrame.Page(index = 0L, last = false))
        snapshot("s1", 2, "B", page = RemoteSnapshotFrame.Page(index = 1L, last = false))
        assertTrue(recorder.log.isEmpty())
        snapshot("s1", 3, "C", cursor = "30", page = RemoteSnapshotFrame.Page(index = 2L, last = true))
        assertEquals(listOf("snapshot:A+B+C"), recorder.log)
        assertEquals(0, sent.filterIsInstance<RemoteUnsubscribeFrame>().size)
    }

    @Test
    fun anEventInsideAPagedSnapshotStartsOver() {
        val recorder = Recorder()
        hub.follow(RemoteSubscription.TERMINAL, "pane-1", recorder)
        hub.onConnected()
        ack("s1")
        snapshot("s1", 1, "A", page = RemoteSnapshotFrame.Page(index = 0L, last = false))
        event("s1", 2, "X")
        assertTrue(recorder.log.isEmpty())
        assertEquals(2, sent.filterIsInstance<RemoteSubscribeFrame>().size)
    }

    @Test
    fun reportsARefusedSubscriptionAndStopsFollowingIt() {
        val recorder = Recorder()
        hub.follow(RemoteSubscription.THREAD, "gone", recorder)
        hub.onConnected()
        assertTrue(hub.onFrame(RemoteErrorFrame(id = lastSubscribe().id, code = RemoteErrorCode.NOT_FOUND)))
        assertEquals(listOf("refused:not-found"), recorder.log)
        hub.onDisconnected()
        hub.onConnected()
        assertEquals("not subscribed again", 1, sent.filterIsInstance<RemoteSubscribeFrame>().size)
    }

    @Test
    fun leavesOtherFramesToTheSession() {
        hub.onConnected()
        assertFalse(hub.onFrame(RemoteAckFrame(id = "command-7")))
        assertFalse(hub.onFrame(RemoteErrorFrame(id = "command-7", code = RemoteErrorCode.FORBIDDEN)))
        assertFalse(event("unknown", 1, "x"))
    }

    @Test
    fun unfollowingSendsUnsubscribeOnlyForAStreamTheGatewayNamed() {
        val stream = hub.follow(RemoteSubscription.JOBS, null, Recorder())
        hub.onConnected()
        ack("s1")
        hub.unfollow(stream)
        assertEquals(RemoteUnsubscribeFrame(id = "id-2", subscription = "s1"), sent.last())
        hub.onDisconnected()
        hub.onConnected()
        assertEquals(1, sent.filterIsInstance<RemoteSubscribeFrame>().size)
    }
}
