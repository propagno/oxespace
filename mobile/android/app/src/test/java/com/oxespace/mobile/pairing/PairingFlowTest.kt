package com.oxespace.mobile.pairing

import com.oxespace.mobile.protocol.RemotePairResponse
import com.oxespace.mobile.protocol.RemotePairingErrorCode
import com.oxespace.mobile.protocol.pairing.PairOutcome
import com.oxespace.mobile.protocol.pairing.PairingQr
import com.oxespace.mobile.protocol.pairing.PairingQrProblem
import com.oxespace.mobile.protocol.pairing.PairingVerification
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PairingFlowTest {
    private val fp = "b".repeat(64)
    private val uri = "oxespace://pair?v=1&host=192.168.0.12&port=7443&fp=$fp&code=AbCdEfGhIjKlMnOpQrSt_-&name=Studio"

    /** Software keys with the same shape as the Keystore's; [deleted] tells whether the flow threw them away. */
    private class FakeKeys : DeviceKeys {
        private val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        var deleted = false
        override fun publicKeySpki(): ByteArray = pair.public.encoded
        override fun sign(data: ByteArray): ByteArray = error("not used while pairing")
        override fun delete() { deleted = true }
    }

    private class FakeStore : PairedDesktopStore {
        var saved: PairedDesktop? = null
        override fun load() = saved
        override fun save(desktop: PairedDesktop) { saved = desktop }
        override fun clear() { saved = null }
    }

    private class Harness(scope: TestScope, answer: (PairingQr, String, String) -> PairOutcome) {
        val keys = mutableMapOf<String, FakeKeys>()
        val store = FakeStore()
        val calls = mutableListOf<Triple<PairingQr, String, String>>()
        val flow = PairingFlow(
            scope = scope,
            io = StandardTestDispatcher(scope.testScheduler),
            pairer = { qr, name, key -> calls += Triple(qr, name, key); answer(qr, name, key) },
            keysFor = { alias -> keys.getOrPut(alias) { FakeKeys() } },
            store = store,
            deviceName = "Pixel 8",
            newAlias = { "alias-${keys.size + 1}" },
        )
    }

    @Test
    fun pairsAndSavesTheDesktop() = runTest {
        val harness = Harness(this) { _, _, _ -> PairOutcome.Paired(RemotePairResponse("dev-7", "tok", 900_000)) }
        harness.flow.onScanned(uri)
        advanceUntilIdle()
        val keys = harness.keys.getValue("alias-1")
        val paired = harness.flow.state.value as PairingState.Paired
        assertEquals(PairedDesktop("dev-7", "192.168.0.12", 7443, fp, "Studio", "alias-1"), paired.desktop)
        assertEquals(paired.desktop, harness.store.saved)
        assertFalse(keys.deleted)
        val (_, name, key) = harness.calls.single()
        assertEquals("Pixel 8", name)
        assertEquals(keys.publicKeySpki().base64Url(), key)
    }

    @Test
    fun showsTheVerificationCodeTheDesktopDerivesWhileWaiting() = runTest {
        val harness = Harness(this) { _, _, _ -> PairOutcome.Unreachable }
        val seen = mutableListOf<PairingState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { harness.flow.state.collect { seen += it } }
        harness.flow.onScanned(uri)
        advanceUntilIdle()
        val waiting = seen.filterIsInstance<PairingState.Waiting>().last()
        assertEquals(PairingVerification.of(harness.keys.getValue("alias-1").publicKeySpki()), waiting.verification)
        assertEquals("Studio", waiting.desktopName)
        assertEquals(PairingState.Failed(PairingFailure.UNREACHABLE), seen.last())
    }

    @Test
    fun mapsEveryRefusalAndDeletesTheUnusedKey() = runTest {
        val cases = mapOf(
            PairOutcome.Refused(RemotePairingErrorCode.PAIRING_EXPIRED) to PairingFailure.CODE_EXPIRED,
            PairOutcome.Refused(RemotePairingErrorCode.PAIRING_USED) to PairingFailure.CODE_USED,
            PairOutcome.Refused(RemotePairingErrorCode.PAIRING_INVALID) to PairingFailure.CODE_INVALID,
            PairOutcome.Refused(RemotePairingErrorCode.PAIRING_REFUSED) to PairingFailure.REFUSED_ON_DESKTOP,
            PairOutcome.Refused(RemotePairingErrorCode.PAIRING_LOCKED) to PairingFailure.LOCKED,
            PairOutcome.Refused(RemotePairingErrorCode.TOO_MANY_DEVICES) to PairingFailure.TOO_MANY_DEVICES,
            PairOutcome.Refused(RemotePairingErrorCode.MALFORMED) to PairingFailure.PROTOCOL,
            PairOutcome.PinMismatch to PairingFailure.WRONG_CERTIFICATE,
            PairOutcome.Unreachable to PairingFailure.UNREACHABLE,
            PairOutcome.Protocol to PairingFailure.PROTOCOL,
        )
        for ((outcome, failure) in cases) {
            val harness = Harness(this) { _, _, _ -> outcome }
            harness.flow.onScanned(uri)
            advanceUntilIdle()
            assertEquals(outcome.toString(), PairingState.Failed(failure), harness.flow.state.value)
            assertTrue(outcome.toString(), harness.keys.getValue("alias-1").deleted)
            assertNull(harness.store.saved)
        }
    }

    @Test
    fun reportsABadCodeAndKeepsLooking() = runTest {
        val harness = Harness(this) { _, _, _ -> error("must not pair") }
        harness.flow.onScanned(uri.replace("192.168.0.12", "8.8.8.8"))
        assertEquals(PairingState.BadCode(PairingQrProblem.PUBLIC_HOST), harness.flow.state.value)
        harness.flow.onScanned("WIFI:S:home;;")
        assertEquals(PairingState.BadCode(PairingQrProblem.NOT_PAIRING), harness.flow.state.value)
        assertTrue(harness.keys.isEmpty())
    }

    @Test
    fun ignoresFurtherFramesOnceAPairingStarted() = runTest {
        val harness = Harness(this) { _, _, _ -> PairOutcome.Refused(RemotePairingErrorCode.PAIRING_REFUSED) }
        repeat(5) { harness.flow.onScanned(uri) }
        advanceUntilIdle()
        // The camera reports the same QR on many frames; only one attempt, one key, one call.
        assertEquals(1, harness.calls.size)
        assertEquals(1, harness.keys.size)
        harness.flow.onScanned(uri)
        advanceUntilIdle()
        assertEquals(1, harness.calls.size)
        harness.flow.scanAgain()
        assertEquals(PairingState.Scanning, harness.flow.state.value)
    }
}
