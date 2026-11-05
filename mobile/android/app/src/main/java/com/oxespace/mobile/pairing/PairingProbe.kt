package com.oxespace.mobile.pairing

import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.SessionEnd
import com.oxespace.mobile.protocol.session.SessionLink
import com.oxespace.mobile.protocol.session.SessionState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/** What a probe of a fresh pairing found. */
sealed interface ProbeResult {
    data object Ok : ProbeResult
    /** The desktop never answered in time: a firewall that drops, or another network. */
    data object TimedOut : ProbeResult
    /** The connection closed before a session: no route, a refusal, the gateway off. */
    data object Closed : ProbeResult
    /** The desktop answered but didn't accept this phone's key, or spoke another protocol. */
    data class Refused(val end: SessionEnd) : ProbeResult
}

/** Checks that the desktop that just accepted the pairing can be reached and signed in to, before it's saved. */
fun interface PairingProbe {
    suspend fun probe(desktop: PairedDesktop, keys: DeviceKeys): ProbeResult
}

/**
 * P3 (Orca's direct-endpoint probe): a C5 session with the new identity, and success means it reached `Ready`.
 * - A first session that closes gets one redial, within [graceMs].
 * - If that redial reaches the authentication step (the desktop answered), it gets [graceMs] once more.
 * - A dead network fails in about [timeoutMs], not after a long wait.
 * Signing in also marks the pairing used on the desktop, so it can't lapse in its 2 minutes (T96).
 */
class SessionPairingProbe(
    private val linkFor: (DesktopTarget, DeviceKeys) -> SessionLink,
    private val timeoutMs: Long = 8_000,
    private val graceMs: Long = 2_000,
    private val redialAfterMs: Long = 500,
) : PairingProbe {
    override suspend fun probe(desktop: PairedDesktop, keys: DeviceKeys): ProbeResult {
        val target = DesktopTarget(desktop.deviceId, desktop.fingerprint, desktop.port, listOfNotNull(desktop.host, desktop.manualHost).distinct())
        val first = attempt(target, keys, timeoutMs, extendOnAuth = false)
        if (first != ProbeResult.Closed) return first
        delay(redialAfterMs)
        return attempt(target, keys, graceMs, extendOnAuth = true)
    }

    private suspend fun attempt(target: DesktopTarget, keys: DeviceKeys, budgetMs: Long, extendOnAuth: Boolean): ProbeResult {
        val link = linkFor(target, keys)
        try {
            link.connect()
            var outcome = withTimeoutOrNull(budgetMs) { link.state.first { it is SessionState.Ready || it is SessionState.Ended || (extendOnAuth && it == SessionState.Authenticating) } }
            // The desktop answered on the redial: give the sign-in one more grace.
            if (outcome == SessionState.Authenticating) outcome = withTimeoutOrNull(graceMs) { link.state.first { it is SessionState.Ready || it is SessionState.Ended } }
            return when (outcome) {
                is SessionState.Ready -> ProbeResult.Ok
                is SessionState.Ended -> if (outcome.reason == SessionEnd.CLOSED) ProbeResult.Closed else ProbeResult.Refused(outcome.reason)
                else -> ProbeResult.TimedOut
            }
        } finally {
            link.close()
        }
    }
}
