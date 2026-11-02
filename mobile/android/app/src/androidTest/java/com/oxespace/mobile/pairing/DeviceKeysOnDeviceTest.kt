package com.oxespace.mobile.pairing

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.oxespace.mobile.protocol.REMOTE_PAIRING_PATH
import com.oxespace.mobile.protocol.RemotePairResponse
import com.oxespace.mobile.protocol.pairing.PairOutcome
import com.oxespace.mobile.protocol.pairing.PairingClient
import com.oxespace.mobile.protocol.pairing.PairingQr
import com.oxespace.mobile.protocol.pairing.PinnedTls
import com.oxespace.mobile.protocol.pairing.certificateFingerprint
import com.oxespace.mobile.protocol.pairing.refreshSigningInput
import java.net.InetAddress
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** The Keystore key and the pinned TLS client on a real Android runtime (Keystore, Conscrypt), not the JVM. */
@RunWith(AndroidJUnit4::class)
class DeviceKeysOnDeviceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val alias = "test-${UUID.randomUUID()}"
    private val keys = AndroidKeystoreDeviceKeys(context, alias)

    @After
    fun tearDown() = keys.delete()

    @Test
    fun makesAP256KeyThatSignsWhatTheDesktopVerifies() {
        val spki = keys.publicKeySpki()
        // isDevicePublicKey in the contract: an uncompressed P-256 SubjectPublicKeyInfo of 91 bytes.
        assertEquals(91, spki.size)
        assertArrayEquals("the same key on every call", spki, keys.publicKeySpki())
        val input = refreshSigningInput("a".repeat(64), "dev-1", "challenge").toByteArray(Charsets.UTF_8)
        val signature = keys.sign(input)
        val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))
        assertTrue(Signature.getInstance("SHA256withECDSA").run { initVerify(publicKey); update(input); verify(signature) })
    }

    @Test
    fun deletingTheKeyMakesANewOne() {
        val first = keys.publicKeySpki()
        keys.delete()
        assertFalse(first.contentEquals(keys.publicKeySpki()))
    }

    @Test
    fun pairsOverPinnedTlsAndRefusesAnotherCertificate() {
        val certificate = HeldCertificate.Builder().commonName("OXESpace gateway").build()
        MockWebServer().use { server ->
            server.useHttps(HandshakeCertificates.Builder().heldCertificate(certificate).build().sslSocketFactory())
            server.start(InetAddress.getByName("127.0.0.1"), 0)
            val client = PairingClient(clientFor = { PinnedTls.client(it, 5_000) }, hostAllowed = { it == "127.0.0.1" })
            val publicKey = Base64.getUrlEncoder().withoutPadding().encodeToString(keys.publicKeySpki())
            val pin = certificateFingerprint(certificate.certificate)

            server.enqueue(MockResponse.Builder().code(200).body("""{"deviceId":"dev-1","accessToken":"tok","expiresInMs":900000}""").build())
            val outcome = client.pair(PairingQr("127.0.0.1", server.port, pin, "AbCdEfGhIjKlMnOpQrSt_-", "Studio"), "Pixel", publicKey)
            assertEquals(PairOutcome.Paired(RemotePairResponse("dev-1", "tok", 900_000)), outcome)
            assertEquals(REMOTE_PAIRING_PATH, server.takeRequest(1, TimeUnit.SECONDS)!!.url.encodedPath)

            val other = certificateFingerprint(HeldCertificate.Builder().build().certificate)
            assertEquals(PairOutcome.PinMismatch, client.pair(PairingQr("127.0.0.1", server.port, other, "AbCdEfGhIjKlMnOpQrSt_-", null), "Pixel", publicKey))
        }
    }
}
