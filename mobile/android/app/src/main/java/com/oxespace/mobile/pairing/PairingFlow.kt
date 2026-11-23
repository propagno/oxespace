package com.oxespace.mobile.pairing

import com.oxespace.mobile.protocol.RemotePairingErrorCode
import com.oxespace.mobile.protocol.pairing.ConnectFailure
import com.oxespace.mobile.protocol.session.SessionEnd
import com.oxespace.mobile.protocol.pairing.PairOutcome
import com.oxespace.mobile.protocol.pairing.PairingQr
import com.oxespace.mobile.protocol.pairing.PairingQrProblem
import com.oxespace.mobile.protocol.pairing.PairingQrRead
import com.oxespace.mobile.protocol.pairing.PairingQrs
import com.oxespace.mobile.protocol.pairing.PairingVerification
import com.oxespace.mobile.protocol.pairing.isReservedDeviceName
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Why pairing ended without a paired desktop; each has its own words and next step on screen. */
enum class PairingFailure {
    CODE_EXPIRED, CODE_USED, CODE_INVALID, REFUSED_ON_DESKTOP, LOCKED, TOO_MANY_DEVICES, WRONG_CERTIFICATE, PROTOCOL,
    /** Android refused the connection on the phone: local network access is off for OXESpace. */
    LOCAL_NETWORK_BLOCKED,
    /** Something on the computer refused the connection: a third-party firewall, or the gateway is off. */
    REFUSED_BY_COMPUTER,
    /** No answer in time: usually a firewall that drops (Windows on a Public Wi-Fi), or another network. */
    TIMED_OUT,
    /** No route to the computer: another Wi-Fi, a VPN, mobile data. */
    UNREACHABLE,
    /** The phone's name is one only OXESpace may speak as; the person renames the phone in Android's settings. */
    RESERVED_NAME,
}

sealed interface PairingState {
    data object Scanning : PairingState
    /** The scanned code can't pair; the camera keeps looking. */
    data class BadCode(val problem: PairingQrProblem) : PairingState
    /**
     * A15 (MOB-1): a valid code was scanned, but Android has not granted local network access yet. The code is held,
     * no key is made and the computer is not contacted until [PairingFlow.onLocalNetworkGranted].
     */
    data class AskingLocalNetwork(val desktopName: String?) : PairingState
    /**
     * Reaching the desktop: from the scan until the request has been sent over the pinned connection. The desktop
     * can't be asking yet, so the phone shows no code and doesn't say "confirm on your computer".
     */
    data class Contacting(val desktopName: String?) : PairingState
    /**
     * The desktop has the request and asks the person, showing the same [verification]. [expiresAt] is the QR's `exp`
     * (epoch ms, OXE-179), null from an older desktop: the phone counts down to it (A14).
     */
    data class Waiting(val desktopName: String?, val verification: String, val expiresAt: Long? = null) : PairingState
    data class Paired(val desktop: PairedDesktop) : PairingState
    data class Failed(val failure: PairingFailure) : PairingState
}

/** The `/pair` call, behind an interface so tests answer for the desktop. */
fun interface Pairer {
    /** [onSent] runs once the desktop has the request (see PairingClient.pair). */
    fun pair(qr: PairingQr, deviceName: String, publicKey: String, onSent: () -> Unit): PairOutcome
}

/**
 * Scan → wait for the desktop → paired or failed. A new device key is made for each attempt and deleted when the
 * attempt fails, so a refused or abandoned pairing leaves nothing behind.
 */
class PairingFlow(
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher,
    private val pairer: Pairer,
    private val keysFor: (alias: String) -> DeviceKeys,
    private val store: PairedDesktopStore,
    private val deviceName: String,
    private val newAlias: () -> String = { "oxespace-device-${UUID.randomUUID()}" },
    /**
     * Runs once the desktop accepted and the pairing is saved: the session starts here, not when the person taps Done.
     * The desktop removes a pairing that doesn't sign in within 2 minutes. In 1.4.2 only Done started the session, so
     * Back, Home, or a slow tap left the new pairing unused. The desktop then removed it, and the phone's next sign-in
     * read "OXESpace removed this phone".
     */
    private val onPaired: () -> Unit = {},
    /** P3: signs in once with the new identity before the pairing is saved. Tests answer it directly. */
    private val probe: PairingProbe = PairingProbe { _, _ -> ProbeResult.Ok },
    /** The phone's clock, to tell whether the code shown has expired (A14). */
    private val now: () -> Long = System::currentTimeMillis,
    /**
     * A15 (MOB-1): whether Android lets the phone reach the local network. Asked after a valid scan, right before the
     * phone first talks to the computer (step 2), instead of before the camera.
     */
    private val localNetworkGranted: () -> Boolean = { true },
) {
    /** The same flow on the phone's own clock. */
    constructor(
        scope: CoroutineScope,
        io: CoroutineDispatcher,
        pairer: Pairer,
        keysFor: (alias: String) -> DeviceKeys,
        store: PairedDesktopStore,
        deviceName: String,
        newAlias: () -> String,
        onPaired: () -> Unit,
        probe: PairingProbe,
        localNetworkGranted: () -> Boolean,
    ) : this(scope, io, pairer, keysFor, store, deviceName, newAlias, onPaired, probe, System::currentTimeMillis, localNetworkGranted)

    private val mutableState = MutableStateFlow<PairingState>(PairingState.Scanning)
    val state: StateFlow<PairingState> = mutableState.asStateFlow()

    /** The attempt in flight, so one whose code expired can be dropped. */
    private var attempt: Job? = null

    /** A15: the scanned code waiting for local network access. */
    private var held: PairingQr? = null

    /** Every decoded frame of the camera arrives here; only a scan while looking can start a pairing. */
    fun onScanned(text: String) {
        val current = mutableState.value
        if (current !is PairingState.Scanning && current !is PairingState.BadCode) return
        when (val read = PairingQrs.read(text)) {
            is PairingQrRead.Refused -> mutableState.value = PairingState.BadCode(read.problem)
            // Checked before the code is spent or a key is made: the desktop would refuse the name anyway.
            is PairingQrRead.Ok -> if (isReservedDeviceName(deviceName)) {
                mutableState.value = PairingState.Failed(PairingFailure.RESERVED_NAME)
            } else if (!localNetworkGranted()) {
                // A15: ask at step 2, before any key or connection; the code waits for Android's answer.
                held = read.qr
                mutableState.value = PairingState.AskingLocalNetwork(read.qr.desktopName)
            } else {
                start(read.qr)
            }
        }
    }

    /** A15: Android granted local network access; the held code goes on to the computer. */
    fun onLocalNetworkGranted() {
        if (mutableState.value !is PairingState.AskingLocalNetwork) return
        val qr = held ?: return
        held = null
        start(qr)
    }

    /**
     * Back to the camera after a failure or a bad code. A14: also once the code shown has expired; that attempt is
     * dropped (its key deleted), since the desktop no longer accepts the code. An attempt still in time keeps going.
     */
    fun scanAgain() {
        val current = mutableState.value
        if (current is PairingState.Waiting) {
            val expiresAt = current.expiresAt ?: return
            if (expiresAt > now()) return
            attempt?.cancel()
            attempt = null
            mutableState.value = PairingState.Scanning
            return
        }
        held = null
        if (current !is PairingState.Contacting) mutableState.value = PairingState.Scanning
    }

    /**
     * OXE-363 (A5): the person's Back or Cancel while the phone contacts the desktop or waits for it. The attempt in
     * flight is dropped: its key is deleted, nothing is saved even if the desktop then answers "paired", the session
     * is not started, and the flow is back at Scanning, so "Parear" opens a fresh camera. A saved pairing stays.
     */
    fun cancel() {
        if (mutableState.value is PairingState.Paired) return
        held = null
        attempt?.cancel()
        attempt = null
        mutableState.value = PairingState.Scanning
    }

    private fun start(qr: PairingQr) {
        val alias = newAlias()
        val keys = keysFor(alias)
        mutableState.value = PairingState.Contacting(qr.desktopName)
        // Whether the attempt's body ran: one cancelled before it started never reaches its own cleanup below.
        var begun = false
        val job = scope.launch {
            begun = true
            // Set once the pairing is in the store: from then on the key belongs to it and is never deleted here.
            var saved = false
            try {
                val spki = withContext(io) { keys.publicKeySpki() }
                val verification = PairingVerification.of(spki)
                // The code shows only once the desktop has the request. Showing it earlier read as "the computer is
                // asking" while a firewall dropped the connection and nothing ever appeared there (1.4.1, a real phone).
                val outcome = withContext(io) {
                    pairer.pair(qr, deviceName, spki.base64Url()) {
                        // A dropped attempt (its code expired) never shows its code over a newer one.
                        if (isActive && mutableState.value is PairingState.Contacting) {
                            mutableState.value = PairingState.Waiting(qr.desktopName, verification, qr.expiresAt)
                        }
                    }
                }
                mutableState.value = when (outcome) {
                    is PairOutcome.Paired -> {
                        val desktop = PairedDesktop(outcome.response.deviceId, qr.host, qr.port, qr.fingerprint, qr.desktopName, alias)
                        // P3: accepted is not reachable. Sign in once with the new identity before saving or saying
                        // "Paired", so a phone that can't keep a session says why now, not later as "removed".
                        mutableState.value = PairingState.Contacting(qr.desktopName)
                        when (val probed = probe.probe(desktop, keys)) {
                            ProbeResult.Ok -> {
                                withContext(io) { store.save(desktop); saved = true }
                                onPaired()
                                PairingState.Paired(desktop)
                            }
                            else -> {
                                withContext(io) { keys.delete() }
                                PairingState.Failed(failureOfProbe(probed))
                            }
                        }
                    }
                    else -> {
                        withContext(io) { keys.delete() }
                        PairingState.Failed(failureOf(outcome))
                    }
                }
            } catch (cancelled: CancellationException) {
                // Backed out (the screen closed, mid-probe too) or dropped because the code expired: the key is deleted
                // before the cancellation goes on, so it never stays behind unsaved.
                if (!saved) withContext(NonCancellable + io) { keys.delete() }
                throw cancelled
            }
        }
        // A Back right after the scan cancels the attempt before it ran: its key is deleted here instead.
        job.invokeOnCompletion { cause ->
            if (cause is CancellationException && !begun) scope.launch(NonCancellable + io) { keys.delete() }
        }
        attempt = job
    }

    private fun failureOfProbe(result: ProbeResult): PairingFailure = when (result) {
        ProbeResult.TimedOut -> PairingFailure.TIMED_OUT
        ProbeResult.Closed -> PairingFailure.UNREACHABLE
        is ProbeResult.Refused -> when (result.end) {
            SessionEnd.UNSUPPORTED_VERSION, SessionEnd.PROTOCOL -> PairingFailure.PROTOCOL
            else -> PairingFailure.REFUSED_ON_DESKTOP
        }
        ProbeResult.Ok -> error("not a failure")
    }

    private fun failureOf(outcome: PairOutcome): PairingFailure = when (outcome) {
        is PairOutcome.Refused -> when (outcome.error) {
            RemotePairingErrorCode.PAIRING_EXPIRED -> PairingFailure.CODE_EXPIRED
            RemotePairingErrorCode.PAIRING_USED -> PairingFailure.CODE_USED
            RemotePairingErrorCode.PAIRING_INVALID -> PairingFailure.CODE_INVALID
            RemotePairingErrorCode.PAIRING_REFUSED -> PairingFailure.REFUSED_ON_DESKTOP
            RemotePairingErrorCode.PAIRING_LOCKED -> PairingFailure.LOCKED
            RemotePairingErrorCode.TOO_MANY_DEVICES -> PairingFailure.TOO_MANY_DEVICES
            RemotePairingErrorCode.MALFORMED -> PairingFailure.PROTOCOL
            RemotePairingErrorCode.RESERVED_NAME -> PairingFailure.RESERVED_NAME
        }
        PairOutcome.PinMismatch -> PairingFailure.WRONG_CERTIFICATE
        is PairOutcome.Unreachable -> when (outcome.failure) {
            ConnectFailure.BLOCKED_ON_PHONE -> PairingFailure.LOCAL_NETWORK_BLOCKED
            ConnectFailure.REFUSED -> PairingFailure.REFUSED_BY_COMPUTER
            ConnectFailure.TIMED_OUT -> PairingFailure.TIMED_OUT
            ConnectFailure.NO_ROUTE -> PairingFailure.UNREACHABLE
        }
        PairOutcome.Protocol -> PairingFailure.PROTOCOL
        is PairOutcome.Paired -> error("not a failure")
    }
}
