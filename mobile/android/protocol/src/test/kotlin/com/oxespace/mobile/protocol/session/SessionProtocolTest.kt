package com.oxespace.mobile.protocol.session

import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteAuthFrame
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteEventFrame
import com.oxespace.mobile.protocol.RemoteHelloFrame
import com.oxespace.mobile.protocol.pairing.refreshSigningInput
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionProtocolTest {
    private val fp = "c".repeat(64)
    private val challenge = "A".repeat(43)
    private val keyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    private var clock = 1_000_000L
    private var ids = 0
    private val tokens = TokenHolder()

    private fun session() = SessionProtocol(
        deviceId = "dev-1",
        fingerprint = fp,
        sign = { data -> Signature.getInstance("SHA256withECDSA").run { initSign(keyPair.private); update(data); sign() } },
        tokens = tokens,
        now = { clock },
        newId = { "id-${++ids}" },
    )

    private fun result(token: String, ttl: Long) = buildJsonObject { put("accessToken", token); put("expiresInMs", ttl) }

    /** What the desktop does with a refresh: verify the DER signature over the contract's signing input. */
    private fun verifies(auth: RemoteAuthFrame): Boolean {
        val refresh = auth.refresh ?: return false
        val input = refreshSigningInput(fp, refresh.deviceId, refresh.nonce).toByteArray(Charsets.UTF_8)
        return Signature.getInstance("SHA256withECDSA").run {
            initVerify(keyPair.public)
            update(input)
            verify(Base64.getUrlDecoder().decode(refresh.signature))
        }
    }

    @Test
    fun saysHelloThenProvesTheKeyAndKeepsTheTokenInMemory() {
        val session = session()
        assertEquals(listOf(RemoteHelloFrame(versions = listOf(1L))), session.onOpen())
        val auth = session.onFrame(RemoteHelloFrame(versions = listOf(1L), desktopName = "Studio", challenge = challenge)).single() as RemoteAuthFrame
        assertNull(auth.accessToken)
        assertEquals("dev-1", auth.refresh!!.deviceId)
        assertEquals(challenge, auth.refresh.nonce)
        assertTrue("the desktop can verify the proof", verifies(auth))
        assertEquals(SessionState.Authenticating, session.state)

        assertEquals(emptyList<Any>(), session.onFrame(RemoteAckFrame(id = auth.id, result = result("tok-1", 900_000))))
        assertEquals(SessionState.Ready("Studio"), session.state)
        assertEquals(AccessToken("tok-1", clock + 900_000, 900_000), tokens.token)
    }

    @Test
    fun reusesAFreshTokenOnTheNextConnection() {
        tokens.token = AccessToken("tok-1", clock + 600_000)
        val auth = session().apply { onOpen() }.onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge)).single() as RemoteAuthFrame
        assertEquals("tok-1", auth.accessToken)
        assertNull(auth.refresh)
    }

    @Test
    fun provesTheKeyWhenTheTokenIsAboutToExpire() {
        tokens.token = AccessToken("tok-1", clock + 10_000)
        val auth = session().apply { onOpen() }.onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge)).single() as RemoteAuthFrame
        assertNull(auth.accessToken)
        assertTrue(verifies(auth))
    }

    @Test
    fun fallsBackToTheKeyOnceWhenTheTokenIsRefused() {
        tokens.token = AccessToken("tok-old", clock + 600_000)
        val session = session().apply { onOpen() }
        val first = session.onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge)).single() as RemoteAuthFrame
        val second = session.onFrame(RemoteErrorFrame(id = first.id, code = RemoteErrorCode.TOKEN_EXPIRED)).single() as RemoteAuthFrame
        assertTrue(verifies(second))
        assertNull(tokens.token)
        // A refused proof is the end: no loop of attempts.
        assertEquals(emptyList<Any>(), session.onFrame(RemoteErrorFrame(id = second.id, code = RemoteErrorCode.UNAUTHENTICATED)))
        assertEquals(SessionState.Ended(SessionEnd.UNAUTHENTICATED), session.state)
    }

    @Test
    fun renewsBeforeTheTokenExpiresOnTheSameConnection() {
        val session = session().apply { onOpen() }
        val auth = session.onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge)).single() as RemoteAuthFrame
        session.onFrame(RemoteAckFrame(id = auth.id, result = result("tok-1", 900_000)))
        assertEquals(clock + 900_000 - 180_000, session.renewalDueAtMs())
        clock += 720_000
        val renewal = session.renew().single() as RemoteAuthFrame
        assertTrue(verifies(renewal))
        assertNull("one renewal at a time", session.renewalDueAtMs())
        assertEquals(emptyList<Any>(), session.renew())
        session.onFrame(RemoteAckFrame(id = renewal.id, result = result("tok-2", 900_000)))
        assertEquals(AccessToken("tok-2", clock + 900_000, 900_000), tokens.token)
        assertEquals(SessionState.Ready(null), session.state)
    }

    @Test
    fun endsForGoodWhenThePhoneIsRevoked() {
        tokens.token = AccessToken("tok-1", clock + 600_000)
        val session = session().apply { onOpen() }
        val auth = session.onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge)).single() as RemoteAuthFrame
        session.onFrame(RemoteAckFrame(id = auth.id, result = result("tok-1", 600_000)))
        // Revoked on the desktop while connected: the error arrives, then the socket closes.
        session.onFrame(RemoteErrorFrame(code = RemoteErrorCode.REVOKED))
        session.onClosed()
        assertEquals(SessionState.Ended(SessionEnd.REVOKED), session.state)
        assertNull(tokens.token)
        assertEquals(emptyList<Any>(), session.onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge)))
    }

    @Test
    fun refusesADesktopItCannotTalkTo() {
        assertEquals(
            SessionState.Ended(SessionEnd.UNSUPPORTED_VERSION),
            session().apply { onOpen(); onFrame(RemoteHelloFrame(versions = listOf(2L), challenge = challenge)) }.state,
        )
        for (bad in listOf(null, "short", "A".repeat(44), "+".repeat(43))) {
            assertEquals(bad.toString(), SessionState.Ended(SessionEnd.PROTOCOL), session().apply { onOpen(); onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = bad)) }.state)
        }
        // Data before authentication, a second hello, or an auth answer without a token break the contract.
        assertEquals(SessionState.Ended(SessionEnd.PROTOCOL), session().apply { onOpen(); onFrame(RemoteEventFrame("s", 1, 1, JsonObject(emptyMap()))) }.state)
        val twice = session().apply { onOpen(); onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge)) }
        twice.onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge))
        assertEquals(SessionState.Ended(SessionEnd.PROTOCOL), twice.state)
        val empty = session().apply { onOpen() }
        val auth = empty.onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge)).single() as RemoteAuthFrame
        empty.onFrame(RemoteAckFrame(id = auth.id, result = buildJsonObject { put("accessToken", JsonPrimitive("")) ; put("expiresInMs", 1) }))
        assertEquals(SessionState.Ended(SessionEnd.PROTOCOL), empty.state)
    }

    @Test
    fun renewsAShortTokenAtHalfItsLifeInsteadOfAtOnce() {
        val session = session().apply { onOpen() }
        val auth = session.onFrame(RemoteHelloFrame(versions = listOf(1L), challenge = challenge)).single() as RemoteAuthFrame
        session.onFrame(RemoteAckFrame(id = auth.id, result = result("tok-1", 60_000)))
        assertEquals(clock + 30_000, session.renewalDueAtMs())
    }

    @Test
    fun aPlainCloseIsNotARevocation() {
        val session = session().apply { onOpen() }
        session.onClosed()
        assertEquals(SessionState.Ended(SessionEnd.CLOSED), session.state)
    }
}
