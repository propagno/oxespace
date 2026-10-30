package com.oxespace.mobile.protocol.session

import com.oxespace.mobile.protocol.FrameRead
import com.oxespace.mobile.protocol.FrameSource
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

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
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
