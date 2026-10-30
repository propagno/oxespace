package com.oxespace.mobile.pairing

import com.oxespace.mobile.protocol.RemotePairingErrorCode
import com.oxespace.mobile.protocol.pairing.PairOutcome
import com.oxespace.mobile.protocol.pairing.PairingQr
import com.oxespace.mobile.protocol.pairing.PairingQrProblem
import com.oxespace.mobile.protocol.pairing.PairingQrRead
import com.oxespace.mobile.protocol.pairing.PairingQrs
import com.oxespace.mobile.protocol.pairing.PairingVerification
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
    CODE_EXPIRED, CODE_USED, REFUSED_ON_DESKTOP, LOCKED, TOO_MANY_DEVICES, WRONG_CERTIFICATE, UNREACHABLE, PROTOCOL,
}

sealed interface PairingState {
    data object Scanning : PairingState
    /** The scanned code can't pair; the camera keeps looking. */
    data class BadCode(val problem: PairingQrProblem) : PairingState
    /** Waiting for the person to confirm on the desktop, which shows the same [verification]. */
    data class Waiting(val desktopName: String?, val verification: String) : PairingState
    data class Paired(val desktop: PairedDesktop) : PairingState
    data class Failed(val failure: PairingFailure) : PairingState
}

/** The `/pair` call, behind an interface so tests answer for the desktop. */
fun interface Pairer {
    fun pair(qr: PairingQr, deviceName: String, publicKey: String): PairOutcome
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
            is PairingQrRead.Ok -> start(read.qr)
        }
    }

    /** Back to the camera after a failure or a bad code. */
    fun scanAgain() {
        if (mutableState.value !is PairingState.Waiting) mutableState.value = PairingState.Scanning
    }

    private fun start(qr: PairingQr) {
        val alias = newAlias()
        val keys = keysFor(alias)
        mutableState.value = PairingState.Waiting(qr.desktopName, verification = "")
        scope.launch {
            val spki = withContext(io) { keys.publicKeySpki() }
            mutableState.value = PairingState.Waiting(qr.desktopName, PairingVerification.of(spki))
            val outcome = withContext(io) { pairer.pair(qr, deviceName, spki.base64Url()) }
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
            RemotePairingErrorCode.PAIRING_REFUSED -> PairingFailure.REFUSED_ON_DESKTOP
            RemotePairingErrorCode.PAIRING_LOCKED -> PairingFailure.LOCKED
            RemotePairingErrorCode.TOO_MANY_DEVICES -> PairingFailure.TOO_MANY_DEVICES
            RemotePairingErrorCode.MALFORMED -> PairingFailure.PROTOCOL
        }
        PairOutcome.PinMismatch -> PairingFailure.WRONG_CERTIFICATE
        PairOutcome.Unreachable -> PairingFailure.UNREACHABLE
        PairOutcome.Protocol -> PairingFailure.PROTOCOL
        is PairOutcome.Paired -> error("not a failure")
    }
}
