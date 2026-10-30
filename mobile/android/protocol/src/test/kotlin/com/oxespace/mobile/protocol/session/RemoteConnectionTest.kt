package com.oxespace.mobile.protocol.session

import com.oxespace.mobile.protocol.FrameRead
import com.oxespace.mobile.protocol.FrameSource
import com.oxespace.mobile.protocol.REMOTE_WS_PATH
import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteAuthFrame
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteHelloFrame
import com.oxespace.mobile.protocol.pairing.PinnedTls
import com.oxespace.mobile.protocol.pairing.certificateFingerprint
import com.oxespace.mobile.protocol.pairing.refreshSigningInput
import java.net.InetAddress
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.ByteString.Companion.encodeUtf8
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** RemoteConnection against a fake gateway that follows C5: pinned TLS, hello with challenge, auth, ack, revocation. */
class RemoteConnectionTest {
    private val certificate = HeldCertificate.Builder().commonName("OXESpace gateway").build()
    private val fp = certificateFingerprint(certificate.certificate)
    private val deviceKey = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val servers = mutableListOf<MockWebServer>()

    @After
    fun tearDown() {
        scheduler.shutdownNow()
        servers.forEach { it.close() }
    }

    /** What the desktop gateway does, as far as M3 needs it. */
    private inner class FakeGateway(private val tokenTtlMs: Long = 900_000) : WebSocketListener() {
        val received = CopyOnWriteArrayList<RemoteFrame>()
        val refreshes = AtomicInteger()
        @Volatile var socket: WebSocket? = null
        private val challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { it.toByte() })

        override fun onOpen(webSocket: WebSocket, response: Response) {
            socket = webSocket
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val frame = (RemoteFrames.read(text, FrameSource.CLIENT) as FrameRead.Ok).frame
            received += frame
            when (frame) {
                is RemoteHelloFrame -> webSocket.send(desktopFrame(RemoteHelloFrame(versions = listOf(1L), desktopName = "Studio", challenge = challenge)))
                is RemoteAuthFrame -> {
                    val refresh = frame.refresh
                    val ok = refresh != null && refresh.nonce == challenge && Signature.getInstance("SHA256withECDSA").run {
                        initVerify(deviceKey.public)
                        update(refreshSigningInput(fp, refresh.deviceId, refresh.nonce).toByteArray(Charsets.UTF_8))
                        verify(Base64.getUrlDecoder().decode(refresh.signature))
                    }
                    if (ok) refreshes.incrementAndGet()
                    val answer = if (ok) {
                        RemoteAckFrame(id = frame.id, result = buildJsonObject { put("accessToken", "tok-${refreshes.get()}"); put("expiresInMs", tokenTtlMs) })
                    } else {
                        RemoteErrorFrame(id = frame.id, code = RemoteErrorCode.UNAUTHENTICATED)
                    }
                    webSocket.send(desktopFrame(answer))
                }
                else -> Unit
            }
        }

        /** How the phone closed, in the order it did. */
        val closes = CopyOnWriteArrayList<Pair<Int, String>>()

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            closes += code to reason
            webSocket.close(1000, null)
        }

        fun revoke() {
            socket!!.send(desktopFrame(RemoteErrorFrame(code = RemoteErrorCode.REVOKED)))
            socket!!.close(1000, null)
        }
    }

    private fun desktopFrame(frame: RemoteFrame) = RemoteFrames.json.encodeToString(RemoteFrame.serializer(), frame)

    private fun gateway(listener: WebSocketListener, held: HeldCertificate = certificate): MockWebServer {
        val server = MockWebServer()
        servers += server
        server.useHttps(HandshakeCertificates.Builder().heldCertificate(held).build().sslSocketFactory())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(listener).build())
        server.start(InetAddress.getByName("127.0.0.1"), 0)
        return server
    }

    private fun connection(port: Int, hosts: List<String> = listOf("127.0.0.1"), tokens: TokenHolder = TokenHolder()) = RemoteConnection(
        target = DesktopTarget("dev-1", fp, port, hosts),
        sign = { data -> Signature.getInstance("SHA256withECDSA").run { initSign(deviceKey.private); update(data); sign() } },
        tokens = tokens,
        scheduler = scheduler,
        clientFor = { PinnedTls.client(it, 5_000) },
        hostAllowed = { it.startsWith("127.0.0.") },
    )

    private fun RemoteConnection.awaitState(timeoutMs: Long = 5_000, predicate: (SessionState) -> Boolean): SessionState =
        runBlocking { withTimeout(timeoutMs) { state.first(predicate) } }

    @Test
    fun connectsOnTheVersionedPathAndAuthenticatesWithTheDeviceKey() {
        val desktop = FakeGateway()
        val server = gateway(desktop)
        val tokens = TokenHolder()
        val connection = connection(server.port, tokens = tokens)
        connection.connect()
        assertEquals(SessionState.Ready("Studio"), connection.awaitState { it is SessionState.Ready })
        assertEquals(REMOTE_WS_PATH, server.takeRequest(1, TimeUnit.SECONDS)!!.url.encodedPath)
        assertEquals("tok-1", tokens.token!!.value)
        assertEquals("127.0.0.1", connection.connectedHost)
        connection.close()
        assertEquals(SessionState.Ended(SessionEnd.CLOSED), connection.state.value)
    }

    @Test
    fun skipsAnAddressWhereAnotherCertificateAnswers() {
        // The last address now belongs to someone else on the same port; the pin refuses it and the next one is tried.
        val desktop = FakeGateway()
        val server = gateway(desktop)
        val impostor = MockWebServer().also { servers += it }
        impostor.useHttps(HandshakeCertificates.Builder().heldCertificate(HeldCertificate.Builder().commonName("impostor").build()).build().sslSocketFactory())
        impostor.enqueue(MockResponse.Builder().webSocketUpgrade(FakeGateway()).build())
        impostor.start(InetAddress.getByName("127.0.0.2"), server.port)
        val connection = connection(server.port, hosts = listOf("127.0.0.2", "127.0.0.1"))
        connection.connect()
        assertTrue(connection.awaitState { it is SessionState.Ready } is SessionState.Ready)
        assertEquals("127.0.0.1", connection.connectedHost)
        assertEquals(0, impostor.requestCount)
        assertTrue(desktop.received.first() is RemoteHelloFrame)
    }

    @Test
    fun endsWithinASecondWhenTheDesktopRevokesThePhone() {
        val desktop = FakeGateway()
        val server = gateway(desktop)
        val tokens = TokenHolder()
        val connection = connection(server.port, tokens = tokens)
        connection.connect()
        connection.awaitState { it is SessionState.Ready }
        val started = System.nanoTime()
        desktop.revoke()
        assertEquals(SessionState.Ended(SessionEnd.REVOKED), connection.awaitState(1_000) { it is SessionState.Ended })
        assertTrue((System.nanoTime() - started) / 1_000_000 < 1_000)
        assertEquals(null, tokens.token)
    }

    @Test
    fun treatsAClose1009AsAProtocolFaultNotADrop() {
        val desktop = FakeGateway()
        val connection = connection(gateway(desktop).port)
        connection.connect()
        connection.awaitState { it is SessionState.Ready }
        // The gateway closes with 1009 when a frame is over 64 KiB instead of answering frame-too-large.
        desktop.socket!!.close(1009, null)
        assertEquals(SessionState.Ended(SessionEnd.PROTOCOL), connection.awaitState { it is SessionState.Ended })
    }

    /** A frame the desktop shouldn't send, and the close the phone answers it with. */
    private data class Unreadable(val name: String, val close: Pair<Int, String>, val send: (WebSocket) -> Unit)

    private val event = """"subscription":"s","seq":1,"schemaVersion":1"""
    private val unreadable = listOf(
        Unreadable("nested past the limit", 1002 to "malformed") { it.send("""{"type":"event",$event,"data":${"[".repeat(100)}${"]".repeat(100)}}""") },
        Unreadable("over 64 KiB", 1009 to "frame-too-large") { it.send("""{"type":"event",$event,"data":"${"x".repeat(70_000)}"}""") },
        Unreadable("bytes that weren't UTF-8", 1002 to "malformed") { it.send(String(byteArrayOf(0xC3.toByte(), 0x28, 0x7B), Charsets.UTF_8)) },
        Unreadable("unknown type", 1002 to "malformed") { it.send("""{"type":"teleport",$event,"data":{}}""") },
        Unreadable("missing field", 1002 to "malformed") { it.send("""{"type":"event","subscription":"s","schemaVersion":1,"data":{}}""") },
        Unreadable("binary message", 1002 to "malformed") { it.send("""{"type":"event",$event,"data":{}}""".encodeUtf8()) },
    )

    @Test
    fun endsAsAProtocolFaultOnAFrameItCantReadAndSaysWhyInTheClose() {
        for (case in unreadable) {
            val desktop = FakeGateway()
            val server = gateway(desktop)
            val connection = connection(server.port)
            connection.connect()
            connection.awaitState { it is SessionState.Ready }
            case.send(desktop.socket!!)
            assertEquals(case.name, SessionState.Ended(SessionEnd.PROTOCOL), connection.awaitState { it is SessionState.Ended })
            runBlocking { withTimeout(5_000) { while (desktop.closes.isEmpty()) kotlinx.coroutines.delay(20) } }
            assertEquals(case.name, listOf(case.close), desktop.closes.toList())
            // The connection never dials again by itself: retrying is the app's call, and it doesn't retry this one.
            assertEquals(case.name, 1, server.requestCount)
        }
    }

    @Test
    fun readsNothingMoreAfterAProtocolFault() {
        val desktop = FakeGateway()
        val server = gateway(desktop)
        val connection = connection(server.port)
        connection.connect()
        connection.awaitState { it is SessionState.Ready }
        // A desktop gone wrong floods the socket; the phone ends once, closes once and answers none of it.
        val socket = desktop.socket!!
        repeat(500) { socket.send("""{"type":"teleport","n":$it}""") }
        socket.send(desktopFrame(RemoteHelloFrame(versions = listOf(1L), desktopName = "Studio", challenge = "x")))
        assertEquals(SessionState.Ended(SessionEnd.PROTOCOL), connection.awaitState { it is SessionState.Ended })
        runBlocking { withTimeout(5_000) { while (desktop.closes.isEmpty()) kotlinx.coroutines.delay(20) } }
        Thread.sleep(200)
        assertEquals(listOf(1002 to "malformed"), desktop.closes.toList())
        assertEquals(SessionState.Ended(SessionEnd.PROTOCOL), connection.state.value)
        assertEquals(2, desktop.received.size) // hello and auth, nothing after the fault
        assertEquals(1, server.requestCount)
    }

    @Test
    fun renewsTheTokenBeforeItExpires() {
        val desktop = FakeGateway(tokenTtlMs = 1_200)
        val tokens = TokenHolder()
        val connection = connection(gateway(desktop).port, tokens = tokens)
        connection.connect()
        connection.awaitState { it is SessionState.Ready }
        // Half of 1.2 s later the phone proves its key again on the same connection and gets a new token.
        runBlocking { withTimeout(5_000) { while (desktop.refreshes.get() < 2) kotlinx.coroutines.delay(50) } }
        assertTrue(desktop.received.filterIsInstance<RemoteHelloFrame>().size == 1)
        runBlocking { withTimeout(2_000) { while (tokens.token?.value != "tok-2") kotlinx.coroutines.delay(20) } }
        assertTrue(connection.state.value is SessionState.Ready)
        connection.close()
    }

    @Test
    fun endsWhenNoAddressAnswers() {
        val server = gateway(FakeGateway())
        val port = server.port
        server.close()
        val connection = connection(port)
        connection.connect()
        assertEquals(SessionState.Ended(SessionEnd.CLOSED), connection.awaitState { it is SessionState.Ended })
    }
}
