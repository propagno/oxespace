package com.oxespace.mobile.protocol.session

import com.oxespace.mobile.protocol.REMOTE_PROTOCOL_VERSION
import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteAuthFrame
import com.oxespace.mobile.protocol.RemoteAuthResult
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteHelloFrame
import com.oxespace.mobile.protocol.RemoteLimits
import com.oxespace.mobile.protocol.pairing.refreshSigningInput
import java.util.Base64
import kotlinx.serialization.SerializationException

/** Why a session ended; each one is a different state on the phone's screen. */
enum class SessionEnd {
    /** The person removed this phone on the desktop: its key and pairing are gone for good. */
    REVOKED,
    /** The desktop speaks another protocol version. */
    UNSUPPORTED_VERSION,
    /** The desktop didn't accept this phone's proof. */
    UNAUTHENTICATED,
    /** Frames that don't follow C5. */
    PROTOCOL,
    /** The connection closed: desktop off, network changed, gateway turned off. */
    CLOSED,
}

sealed interface SessionState {
    data object Opening : SessionState
    data object Authenticating : SessionState
    data class Ready(val desktopName: String?) : SessionState
    data class Ended(val reason: SessionEnd) : SessionState
}

/** An access token and when it stops working, on the phone's monotonic clock: the desktop gives a duration, never a date. */
data class AccessToken(val value: String, val expiresAtMs: Long, val lifetimeMs: Long = RemoteLimits.ACCESS_TOKEN_TTL_MS)

/** Holds the access token in memory only, across reconnections; nothing is written to disk. */
class TokenHolder {
    @Volatile var token: AccessToken? = null
}

/**
 * The start of a C5 session, without the transport: hello → auth → ready, renewal before the token expires, and the
 * desktop's refusals. The caller sends what each call returns and feeds in every frame the desktop sends.
 *
 * Authentication uses the access token while it has more than [reuseMarginMs] left; otherwise it proves the device
 * key by signing `refreshSigningInput(fp, deviceId, challenge)`. A refused token falls back to that proof once.
 */
class SessionProtocol(
    private val deviceId: String,
    private val fingerprint: String,
    private val sign: (ByteArray) -> ByteArray,
    private val tokens: TokenHolder,
    private val now: () -> Long,
    private val newId: () -> String,
    private val reuseMarginMs: Long = 30_000,
) {
    var state: SessionState = SessionState.Opening
        private set

    private var challenge: String? = null
    private var desktopName: String? = null
    private var pendingAuth: String? = null
    private var pendingWithToken = false

    fun onOpen(): List<RemoteFrame> = listOf(RemoteHelloFrame(versions = listOf(REMOTE_PROTOCOL_VERSION.toLong())))

    fun onFrame(frame: RemoteFrame): List<RemoteFrame> {
        if (state is SessionState.Ended) return emptyList()
        return when (frame) {
            is RemoteHelloFrame -> onHello(frame)
            is RemoteAckFrame -> if (frame.id == pendingAuth) onAuthAck(frame) else emptyList()
            is RemoteErrorFrame -> onError(frame)
            else -> if (state is SessionState.Ready) emptyList() else end(SessionEnd.PROTOCOL)
        }
    }

    /** When to call [renew]: three minutes (or half its life, if shorter) before the token runs out. */
    fun renewalDueAtMs(): Long? {
        val token = tokens.token ?: return null
        if (state !is SessionState.Ready || pendingAuth != null) return null
        return token.expiresAtMs - minOf(RENEW_AHEAD_MS, token.lifetimeMs / 2)
    }

    /** A new token on the open connection, proved with the device key against this connection's challenge. */
    fun renew(): List<RemoteFrame> {
        if (state !is SessionState.Ready || pendingAuth != null) return emptyList()
        return listOf(refreshFrame())
    }

    /** A frame from the desktop failed the C5 checks (size, JSON, type). */
    fun onUnreadable() {
        if (state !is SessionState.Ended) end(SessionEnd.PROTOCOL)
    }

    /** The transport closed; the reason already set (revoked, protocol…) wins over a plain close. */
    fun onClosed() {
        if (state !is SessionState.Ended) state = SessionState.Ended(SessionEnd.CLOSED)
    }

    private fun onHello(hello: RemoteHelloFrame): List<RemoteFrame> {
        if (state != SessionState.Opening) return end(SessionEnd.PROTOCOL)
        if (REMOTE_PROTOCOL_VERSION.toLong() !in hello.versions) return end(SessionEnd.UNSUPPORTED_VERSION)
        val nonce = hello.challenge?.takeIf { CHALLENGE.matches(it) } ?: return end(SessionEnd.PROTOCOL)
        challenge = nonce
        desktopName = hello.desktopName
        state = SessionState.Authenticating
        val token = tokens.token
        return if (token != null && token.expiresAtMs - now() > reuseMarginMs) {
            listOf(tokenFrame(token.value))
        } else {
            listOf(refreshFrame())
        }
    }

    private fun onAuthAck(ack: RemoteAckFrame): List<RemoteFrame> {
        pendingAuth = null
        val result = try {
            ack.result?.let { RemoteFrames.json.decodeFromJsonElement(RemoteAuthResult.serializer(), it) }
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
        if (result == null || result.accessToken.isEmpty() || result.expiresInMs <= 0) return end(SessionEnd.PROTOCOL)
        tokens.token = AccessToken(result.accessToken, now() + result.expiresInMs, result.expiresInMs)
        state = SessionState.Ready(desktopName)
        return emptyList()
    }

    private fun onError(error: RemoteErrorFrame): List<RemoteFrame> {
        if (error.code == RemoteErrorCode.REVOKED) {
            tokens.token = null
            return end(SessionEnd.REVOKED)
        }
        if (error.code == RemoteErrorCode.UNSUPPORTED_VERSION) return end(SessionEnd.UNSUPPORTED_VERSION)
        if (error.id == null || error.id != pendingAuth) {
            // The token ran out on this connection before a renewal landed; the desktop closes with 1008 next, and the
            // reconnection proves the key instead of offering a token it would refuse.
            if (error.code == RemoteErrorCode.TOKEN_EXPIRED) tokens.token = null
            // An error about something else (a command, a subscription) is for the layer that sent it.
            return if (state is SessionState.Ready) emptyList() else end(SessionEnd.PROTOCOL)
        }
        pendingAuth = null
        val refused = error.code == RemoteErrorCode.TOKEN_EXPIRED || error.code == RemoteErrorCode.UNAUTHENTICATED
        if (refused && pendingWithToken) {
            // The token was stale or forgotten by a restarted desktop: prove the key instead, once.
            tokens.token = null
            return listOf(refreshFrame())
        }
        tokens.token = null
        return end(SessionEnd.UNAUTHENTICATED)
    }

    private fun tokenFrame(value: String): RemoteAuthFrame {
        val id = newId()
        pendingAuth = id
        pendingWithToken = true
        return RemoteAuthFrame(id = id, accessToken = value)
    }

    private fun refreshFrame(): RemoteAuthFrame {
        val nonce = checkNotNull(challenge)
        val signature = sign(refreshSigningInput(fingerprint, deviceId, nonce).toByteArray(Charsets.UTF_8))
        val id = newId()
        pendingAuth = id
        pendingWithToken = false
        return RemoteAuthFrame(id = id, refresh = RemoteAuthFrame.Refresh(deviceId, nonce, base64Url(signature)))
    }

    private fun end(reason: SessionEnd): List<RemoteFrame> {
        state = SessionState.Ended(reason)
        pendingAuth = null
        return emptyList()
    }

    private fun base64Url(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    private companion object {
        /** isHelloChallenge: 32 bytes in base64url without padding. */
        val CHALLENGE = Regex("^[A-Za-z0-9_-]{43}$")
        const val RENEW_AHEAD_MS = 3 * 60_000L
    }
}
