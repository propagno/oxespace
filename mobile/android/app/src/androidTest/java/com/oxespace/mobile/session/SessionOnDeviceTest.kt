package com.oxespace.mobile.session

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.oxespace.mobile.pairing.AndroidKeystoreDeviceKeys
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
import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.RemoteConnection
import com.oxespace.mobile.protocol.session.SessionEnd
import com.oxespace.mobile.protocol.session.SessionState
import com.oxespace.mobile.protocol.session.TokenHolder
import java.net.InetAddress
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors
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
import org.junit.Test
import org.junit.runner.RunWith

/** The M3 session on a real Android runtime: WSS over pinned TLS (Conscrypt) and a refresh signed in the Keystore. */
@RunWith(AndroidJUnit4::class)
class SessionOnDeviceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val keys = AndroidKeystoreDeviceKeys(context, "test-${UUID.randomUUID()}")
    private val certificate = HeldCertificate.Builder().commonName("OXESpace gateway").build()
    private val fp = certificateFingerprint(certificate.certificate)
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val server = MockWebServer()

    @After
    fun tearDown() {
        keys.delete()
        scheduler.shutdownNow()
        server.close()
    }

    /** Verifies the refresh with the public key the phone registered, as the desktop does. */
    private inner class Gateway : WebSocketListener() {
        @Volatile var socket: WebSocket? = null
        private val challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { (it * 7).toByte() })
        private val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(keys.publicKeySpki()))

        override fun onOpen(webSocket: WebSocket, response: Response) { socket = webSocket }

        override fun onMessage(webSocket: WebSocket, text: String) {
            when (val frame = (RemoteFrames.read(text, FrameSource.CLIENT) as FrameRead.Ok).frame) {
                is RemoteHelloFrame -> webSocket.send(json(RemoteHelloFrame(versions = listOf(1L), desktopName = "Studio", challenge = challenge)))
                is RemoteAuthFrame -> {
                    val refresh = frame.refresh!!
                    val valid = Signature.getInstance("SHA256withECDSA").run {
                        initVerify(publicKey)
                        update(refreshSigningInput(fp, refresh.deviceId, refresh.nonce).toByteArray(Charsets.UTF_8))
                        verify(Base64.getUrlDecoder().decode(refresh.signature))
                    }
                    webSocket.send(json(if (valid) RemoteAckFrame(id = frame.id, result = buildJsonObject { put("accessToken", "tok"); put("expiresInMs", 900_000) }) else RemoteErrorFrame(id = frame.id, code = RemoteErrorCode.UNAUTHENTICATED)))
                }
                else -> Unit
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }

        private fun json(frame: RemoteFrame) = RemoteFrames.json.encodeToString(RemoteFrame.serializer(), frame)
    }

    @Test
    fun authenticatesWithTheKeystoreKeyAndEndsOnRevocation() {
        val gateway = Gateway()
        server.useHttps(HandshakeCertificates.Builder().heldCertificate(certificate).build().sslSocketFactory())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(gateway).build())
        server.start(InetAddress.getByName("127.0.0.1"), 0)
        val connection = RemoteConnection(
            target = DesktopTarget("dev-1", fp, server.port, listOf("127.0.0.1")),
            sign = keys::sign,
            tokens = TokenHolder(),
            scheduler = scheduler,
            clientFor = { PinnedTls.client(it, 5_000) },
            hostAllowed = { it == "127.0.0.1" },
        )
        connection.connect()
        val ready = runBlocking { withTimeout(10_000) { connection.state.first { it is SessionState.Ready || it is SessionState.Ended } } }
        assertEquals(SessionState.Ready("Studio"), ready)

        gateway.socket!!.send(RemoteFrames.json.encodeToString(RemoteFrame.serializer(), RemoteErrorFrame(code = RemoteErrorCode.REVOKED)))
        gateway.socket!!.close(1000, null)
        val ended = runBlocking { withTimeout(1_000) { connection.state.first { it is SessionState.Ended } } }
        assertEquals(SessionState.Ended(SessionEnd.REVOKED), ended)
    }
}
