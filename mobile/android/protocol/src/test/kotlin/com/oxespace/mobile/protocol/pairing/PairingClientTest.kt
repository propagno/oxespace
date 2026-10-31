package com.oxespace.mobile.protocol.pairing

import com.oxespace.mobile.protocol.RemotePairRequest
import com.oxespace.mobile.protocol.RemotePairResponse
import com.oxespace.mobile.protocol.RemotePairingErrorCode
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** `/pair` against a fake gateway with its own self-signed certificate, as B9 will have. */
class PairingClientTest {
    private val gatewayCertificate = HeldCertificate.Builder().commonName("OXESpace gateway").addSubjectAlternativeName("localhost").build()
    private val otherCertificate = HeldCertificate.Builder().commonName("Someone else").build()
    private lateinit var server: MockWebServer
    private val code = "AbCdEfGhIjKlMnOpQrSt_-"
    private val client = PairingClient(clientFor = { PinnedTls.client(it, 5_000) }, hostAllowed = { it == "127.0.0.1" })

    private fun start(certificate: HeldCertificate) {
        server = MockWebServer()
        server.useHttps(HandshakeCertificates.Builder().heldCertificate(certificate).build().sslSocketFactory())
        server.start(java.net.InetAddress.getByName("127.0.0.1"), 0)
    }

    private fun qr(fingerprint: String = certificateFingerprint(gatewayCertificate.certificate)) =
        PairingQr("127.0.0.1", server.port, fingerprint, code, "Studio")

    @Before
    fun setUp() = start(gatewayCertificate)

    @After
    fun tearDown() = server.close()

    @Test
    fun pairsAndSendsTheCodeNameAndPublicKey() {
        server.enqueue(MockResponse.Builder().code(200).body("""{"deviceId":"dev-1","accessToken":"tok","expiresInMs":900000,"extra":true}""").build())
        val outcome = client.pair(qr(), "Pixel 8", "PUBKEY")
        assertEquals(PairOutcome.Paired(RemotePairResponse("dev-1", "tok", 900_000)), outcome)
        val request = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/pair", request.url.encodedPath)
        assertEquals(RemotePairRequest(code, "Pixel 8", "PUBKEY"), Json.decodeFromString(RemotePairRequest.serializer(), request.body!!.utf8()))
    }

    @Test
    fun sendsOnlyWhatTheGatewayAccepts() {
        val names = mapOf("  Pixel\n8\u0007 " to "Pixel8", "x".repeat(100) to "x".repeat(64), "\t \n" to "Android")
        for ((given, sent) in names) {
            server.enqueue(MockResponse.Builder().code(200).body("""{"deviceId":"d","accessToken":"t","expiresInMs":1}""").build())
            client.pair(qr(), given, "PUBKEY")
            val body = Json.parseToJsonElement(server.takeRequest(1, TimeUnit.SECONDS)!!.body!!.utf8()) as kotlinx.serialization.json.JsonObject
            // readPairRequest refuses any other key.
            assertEquals(setOf("code", "deviceName", "publicKey"), body.keys)
            assertEquals(sent, (body["deviceName"] as kotlinx.serialization.json.JsonPrimitive).content)
        }
    }

    @Test
    fun endsTheHandshakeWhenTheCertificateIsNotTheOneInTheQr() {
        server.enqueue(MockResponse.Builder().code(200).body("{}").build())
        assertEquals(PairOutcome.PinMismatch, client.pair(qr(fingerprint = certificateFingerprint(otherCertificate.certificate)), "Pixel 8", "PUBKEY"))
        // Nothing reached the impostor: not the code, not the key.
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
    }

    @Test
    fun reportsEachRefusalOfTheDesktop() {
        for (error in RemotePairingErrorCode.entries) {
            server.enqueue(MockResponse.Builder().code(if (error == RemotePairingErrorCode.PAIRING_LOCKED) 429 else 403).body("""{"code":"${error.wire}"}""").build())
            assertEquals(PairOutcome.Refused(error), client.pair(qr(), "Pixel 8", "PUBKEY"))
        }
    }

    @Test
    fun treatsAnythingOffContractAsAProtocolError() {
        val bodies = listOf(200 to "not json", 200 to """{"deviceId":"d"}""", 403 to """{"code":"teleported"}""", 500 to "{}", 200 to "x".repeat(70_000))
        for ((status, body) in bodies) {
            server.enqueue(MockResponse.Builder().code(status).body(body).build())
            assertEquals("$status $body".take(40), PairOutcome.Protocol, client.pair(qr(), "Pixel 8", "PUBKEY"))
        }
    }

    @Test
    fun neverCallsAnAddressOutsideTheLan() {
        val strict = PairingClient(clientFor = { PinnedTls.client(it, 5_000) })
        assertEquals(PairOutcome.Protocol, strict.pair(qr(), "Pixel 8", "PUBKEY"))
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
    }

    @Test
    fun reportsAnUnreachableDesktop() {
        val port = server.port
        server.close()
        assertEquals(PairOutcome.Unreachable, client.pair(PairingQr("127.0.0.1", port, "a".repeat(64), code, null), "Pixel 8", "PUBKEY"))
    }
}
