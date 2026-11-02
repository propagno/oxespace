package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.FrameRead
import com.oxespace.mobile.protocol.FrameSource
import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteAuthFrame
import com.oxespace.mobile.protocol.RemoteEventFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteHelloFrame
import com.oxespace.mobile.protocol.RemoteSnapshotFrame
import com.oxespace.mobile.protocol.RemoteSubscribeFrame
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.RemoteThreadItem
import com.oxespace.mobile.protocol.pairing.PinnedTls
import com.oxespace.mobile.protocol.pairing.certificateFingerprint
import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.RemoteConnection
import com.oxespace.mobile.protocol.session.SessionEnd
import com.oxespace.mobile.protocol.session.SessionState
import com.oxespace.mobile.protocol.session.TokenHolder
import java.net.InetAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** M4 acceptance: after the network drops and comes back, the conversation resumes without losing or repeating items. */
class LiveResumeTest {
    private val certificate = HeldCertificate.Builder().commonName("OXESpace gateway").build()
    private val fp = certificateFingerprint(certificate.certificate)
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val server = MockWebServer()

    @After
    fun tearDown() {
        scheduler.shutdownNow()
        server.close()
    }

    /** The desktop's conversation: messages by revision. The cursor is `e:<revision>`, as readSince would build it. */
    private class Desktop {
        val messages = CopyOnWriteArrayList<String>()
        fun item(index: Int) = """{"seq":${index + 1},"item":{"type":"message","id":"m$index","role":"assistant","text":"${messages[index]}"}}"""
        val header = """{"id":"t-1","workspaceId":"w","title":"T","provider":"claude","status":"running","pendingRequests":0,"updatedAt":1,"queued":0,"canSteer":true}"""
    }

    /** One connection of the gateway: auth, the thread stream from a cursor, and live events while it lasts. */
    private inner class Gateway(private val desktop: Desktop, private val cutsEverySnapshot: Boolean = false) : WebSocketListener() {
        @Volatile var socket: WebSocket? = null
        @Volatile private var subscription: String? = null
        private var seq = 0L
        val subscribes = CopyOnWriteArrayList<RemoteSubscribeFrame>()
        val closes = CopyOnWriteArrayList<Int>()

        override fun onOpen(webSocket: WebSocket, response: Response) { socket = webSocket }

        override fun onMessage(webSocket: WebSocket, text: String) {
            socket = webSocket
            when (val frame = (RemoteFrames.read(text, FrameSource.CLIENT) as FrameRead.Ok).frame) {
                is RemoteHelloFrame -> send(RemoteHelloFrame(versions = listOf(1L), challenge = "A".repeat(43)))
                is RemoteAuthFrame -> send(RemoteAckFrame(id = frame.id, result = json("""{"accessToken":"tok","expiresInMs":900000}""")))
                is RemoteSubscribeFrame -> synchronized(this) {
                    subscribes += frame
                    subscription = "s-${subscribes.size}"
                    send(RemoteAckFrame(id = frame.id, subscription = subscription))
                    val from = frame.cursor?.removePrefix("e:")?.toIntOrNull()
                    if (cutsEverySnapshot) {
                        // A desktop gone wrong: the first page of a snapshot, then an event before the rest, every time.
                        send(RemoteSnapshotFrame(subscription!!, ++seq, 2, json("{}"), null, RemoteSnapshotFrame.Page(index = 0L, last = false)))
                        pushEvent(0)
                    } else if (from == null) {
                        val items = desktop.messages.indices.joinToString(",") { desktop.item(it) }
                        send(RemoteSnapshotFrame(subscription!!, ++seq, 2, json("""{"thread":${desktop.header},"items":[$items],"hasMore":false}"""), "e:${desktop.messages.size}"))
                    } else {
                        // Exactly what came after the cursor, one event per revision.
                        for (index in from until desktop.messages.size) pushEvent(index)
                    }
                }
                else -> Unit
            }
        }

        fun pushEvent(index: Int) = synchronized(this) {
            val name = subscription ?: return@synchronized
            send(RemoteEventFrame(name, ++seq, 2, json("""{"thread":${desktop.header},"items":[${desktop.item(index)}]}"""), "e:${index + 1}"))
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            closes += code
            webSocket.close(1000, null)
        }

        private fun send(frame: RemoteFrame) = socket!!.send(RemoteFrames.json.encodeToString(RemoteFrame.serializer(), frame))
        private fun json(text: String): JsonElement = RemoteFrames.json.parseToJsonElement(text)
    }

    private fun connect(streams: LiveStreams, tokens: TokenHolder, awaitReady: Boolean = true) = RemoteConnection(
        target = DesktopTarget("dev-1", fp, server.port, listOf("127.0.0.1")),
        sign = { ByteArray(72) },
        tokens = tokens,
        scheduler = scheduler,
        clientFor = { PinnedTls.client(it, 5_000) },
        hostAllowed = { it == "127.0.0.1" },
        streams = streams,
    ).also { connection ->
        connection.connect()
        if (awaitReady) runBlocking { withTimeout(5_000) { connection.state.first { it is SessionState.Ready } } }
    }

    private fun texts(timeline: ThreadTimeline) = timeline.items.map { (it.item as RemoteThreadItem.Message).text }

    private fun awaitTexts(timeline: ThreadTimeline, expected: List<String>) = runBlocking {
        withTimeout(5_000) { while (synchronized(timeline) { texts(timeline) } != expected) delay(20) }
    }

    @Test
    fun resumesAfterADropWithoutLosingOrRepeatingItems() {
        val desktop = Desktop().apply { messages += listOf("one", "two") }
        val first = Gateway(desktop)
        val second = Gateway(desktop)
        server.useHttps(HandshakeCertificates.Builder().heldCertificate(certificate).build().sslSocketFactory())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(first).build())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(second).build())
        server.start(InetAddress.getByName("127.0.0.1"), 0)

        val streams = LiveStreams()
        val tokens = TokenHolder()
        val timeline = ThreadTimeline()
        streams.follow(RemoteSubscription.THREAD, "t-1", timeline)

        connect(streams, tokens)
        awaitTexts(timeline, listOf("one", "two"))
        desktop.messages += "three"
        first.pushEvent(2)
        awaitTexts(timeline, listOf("one", "two", "three"))

        // The connection goes away (the server side of the fake can't cut the socket, so it closes it); the desktop keeps
        // working meanwhile.
        first.socket!!.close(1001, null)
        desktop.messages += listOf("four", "five")

        connect(streams, tokens)
        awaitTexts(timeline, listOf("one", "two", "three", "four", "five"))
        assertEquals("resumed from the last cursor applied", "e:3", second.subscribes.single().cursor)
        assertNull("the first connection subscribed from scratch", first.subscribes.single().cursor)
        assertEquals(5, timeline.items.map { it.item }.distinct().size)
    }

    @Test
    fun endsTheSessionWhenTheDesktopKeepsBreakingAStream() {
        val desktop = Desktop().apply { messages += "one" }
        val gateway = Gateway(desktop, cutsEverySnapshot = true)
        server.useHttps(HandshakeCertificates.Builder().heldCertificate(certificate).build().sslSocketFactory())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(gateway).build())
        server.start(InetAddress.getByName("127.0.0.1"), 0)

        val streams = LiveStreams()
        val timeline = ThreadTimeline()
        streams.follow(RemoteSubscription.THREAD, "t-1", timeline)
        val connection = connect(streams, TokenHolder(), awaitReady = false)
        assertEquals(SessionState.Ended(SessionEnd.PROTOCOL), runBlocking { withTimeout(5_000) { connection.state.first { it is SessionState.Ended } } })
        runBlocking { withTimeout(5_000) { while (gateway.closes.isEmpty()) delay(20) } }
        assertEquals(listOf(1002), gateway.closes.toList())
        assertEquals("asked four times, then gave up", 4, gateway.subscribes.size)
        assertTrue(timeline.items.isEmpty())
    }
}
