package com.oxespace.mobile.pairing

import com.oxespace.mobile.protocol.RemotePairingErrorCode
import com.oxespace.mobile.protocol.pairing.ConnectFailure
import com.oxespace.mobile.protocol.pairing.PairOutcome
import com.oxespace.mobile.protocol.pairing.PairingQr
import com.oxespace.mobile.protocol.pairing.PairingQrProblem
import com.oxespace.mobile.protocol.pairing.PairingQrRead
import com.oxespace.mobile.protocol.pairing.PairingQrs
import com.oxespace.mobile.protocol.pairing.PairingVerification
import com.oxespace.mobile.protocol.pairing.isReservedDeviceName
import java.util.UUID
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
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
     * Reaching the desktop: from the scan until the request has been sent over the pinned connection. The desktop
     * can't be asking yet, so the phone shows no code and doesn't say "confirm on your computer".
     */
    data class Contacting(val desktopName: String?) : PairingState
    /** The desktop has the request and asks the person, showing the same [verification]. */
    data class Waiting(val desktopName: String?, val verification: String) : PairingState
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
) {
    private val mutableState = MutableStateFlow<PairingState>(PairingState.Scanning)
    val state: StateFlow<PairingState> = mutableState.asStateFlow()

    /** Every decoded frame of the camera arrives here; only a scan while looking can start a pairing. */
    fun onScanned(text: String) {
        val current = mutableState.value
        if (current !is PairingState.Scanning && current !is PairingState.BadCode) return
        when (val read = PairingQrs.read(text)) {
            is PairingQrRead.Refused -> mutableState.value = PairingState.BadCode(read.problem)
            // Checked before the code is spent or a key is made: the desktop would refuse the name anyway.
            is PairingQrRead.Ok -> if (isReservedDeviceName(deviceName)) {
                mutableState.value = PairingState.Failed(PairingFailure.RESERVED_NAME)
            } else {
                start(read.qr)
            }
        }
    }

    /** Back to the camera after a failure or a bad code. */
    fun scanAgain() {
        val current = mutableState.value
        if (current !is PairingState.Waiting && current !is PairingState.Contacting) mutableState.value = PairingState.Scanning
    }

    private fun start(qr: PairingQr) {
        val alias = newAlias()
        val keys = keysFor(alias)
        mutableState.value = PairingState.Contacting(qr.desktopName)
        scope.launch {
            val spki = withContext(io) { keys.publicKeySpki() }
            val verification = PairingVerification.of(spki)
            // The code shows only once the desktop has the request. Showing it earlier read as "the computer is asking"
            // while a firewall dropped the connection and nothing ever appeared there (1.4.1, a real phone on Wi-Fi).
            val outcome = withContext(io) {
                pairer.pair(qr, deviceName, spki.base64Url()) {
                    if (mutableState.value is PairingState.Contacting) mutableState.value = PairingState.Waiting(qr.desktopName, verification)
                }
            }
            mutableState.value = when (outcome) {
                is PairOutcome.Paired -> {
                    val desktop = PairedDesktop(outcome.response.deviceId, qr.host, qr.port, qr.fingerprint, qr.desktopName, alias)
                    withContext(io) { store.save(desktop) }
                    PairingState.Paired(desktop)
                }
                else -> {
                    withContext(io) { keys.delete() }
                    PairingState.Failed(failureOf(outcome))
                }
            }
        }
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
