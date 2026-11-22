package com.oxespace.mobile.pairing

import com.oxespace.mobile.protocol.RemotePairResponse
import com.oxespace.mobile.protocol.pairing.PairOutcome
import com.oxespace.mobile.protocol.pairing.PairingQr
import java.io.File
import java.lang.reflect.InvocationTargetException
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 152p1c (phase F1, Jira OXE-363). Written by the planner; the executor must not edit it.
 *
 * Contract: PairingFlow (and PairingViewModel) gain `cancel()`. A Back or Cancel while the phone contacts the desktop or
 * waits for it drops the attempt in flight: its key is deleted, nothing is saved even if the desktop then answers
 * "paired", the session is not started, and the flow is back at Scanning, so "Parear" opens a fresh camera.
 * MainActivity's Back from pairing calls it. `cancel()` is reached by name, so this file compiles on main before it
 * exists (the whole test source set compiles together).
 * Gradle runs unit tests from the module directory (`mobile/android/app`).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class P1cPairingCancelTest {
    private val fp = "b".repeat(64)
    private val uri = "oxespace://pair?v=1&host=192.168.0.12&port=7443&fp=$fp&code=AbCdEfGhIjKlMnOpQrSt_-&name=Studio"

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

    private class Harness(scope: TestScope, answer: Harness.(PairingQr, () -> Unit) -> PairOutcome) {
        val keys = mutableMapOf<String, FakeKeys>()
        val store = FakeStore()
        var started = 0
        val flow: PairingFlow = PairingFlow(
            scope = scope,
            io = StandardTestDispatcher(scope.testScheduler),
            pairer = { qr, _, _, onSent -> answer(qr, onSent) },
            keysFor = { alias -> keys.getOrPut(alias) { FakeKeys() } },
            store = store,
            deviceName = "Pixel 8",
            newAlias = { "alias-${keys.size + 1}" },
            onPaired = { started++ },
            probe = { _, _ -> ProbeResult.Ok },
        )

        /** The person's Back or Cancel: PairingFlow.cancel(), by name. */
        fun cancel() {
            val method = try {
                PairingFlow::class.java.getMethod("cancel")
            } catch (missing: NoSuchMethodException) {
                throw AssertionError("PairingFlow has no cancel(): a Back during pairing cannot drop the attempt", missing)
            }
            try { method.invoke(flow) } catch (thrown: InvocationTargetException) { throw thrown.targetException }
        }
    }

    private val paired = PairOutcome.Paired(RemotePairResponse("dev-7", "tok", 900_000))

    @Test
    fun aBackWhileTheDesktopAsksDropsTheAttemptEvenIfTheDesktopThenAnswersPaired() = runTest {
        val harness = Harness(this) { _, onSent ->
            onSent()
            // The desktop shows the code; the person taps Cancel before confirming there, then the desktop says paired.
            assertTrue("the phone waits for the desktop", flow.state.value is PairingState.Waiting)
            cancel()
            paired
        }
        harness.flow.onScanned(uri)
        advanceUntilIdle()
        assertNull("a cancelled pairing is never saved", harness.store.saved)
        assertEquals("a cancelled pairing never starts the session", 0, harness.started)
        assertTrue("the cancelled attempt's key is deleted", harness.keys.values.all { it.deleted })
        assertEquals(PairingState.Scanning, harness.flow.state.value)
    }

    @Test
    fun aBackWhileContactingReopensPairingAtTheCamera() = runTest {

        val harness = Harness(this) { _, onSent -> onSent(); paired }
        harness.flow.onScanned(uri)
        assertTrue("the phone contacts the desktop", harness.flow.state.value is PairingState.Contacting)
        harness.cancel()
        advanceUntilIdle()
        assertNull(harness.store.saved)
        assertEquals(0, harness.started)
        assertTrue(harness.keys.values.all { it.deleted })
        assertEquals(PairingState.Scanning, harness.flow.state.value)
        // A new scan after the cancel starts a new attempt from the camera.
        harness.flow.onScanned(uri)
        advanceUntilIdle()
        assertTrue("a new scan pairs again", harness.flow.state.value is PairingState.Paired)
        assertEquals(1, harness.started)
    }

    // rigor: source-assertion — MainActivity is an Activity; the criterion is that its Back from pairing cancels.
    @Test
    fun mainActivityBackFromPairingCancelsTheAttempt() {
        val source = File("src/main/java/com/oxespace/mobile/MainActivity.kt").readText()
        val call = Regex("""Pairing\([^\n]*onBack\s*=\s*\{[^}]*\bpairing\.cancel\(\)""").find(source)
        assertTrue("MainActivity's Pairing(onBack = …) calls pairing.cancel()", call != null)
        val vm = File("src/main/java/com/oxespace/mobile/pairing/PairingViewModel.kt").readText()
        assertTrue("PairingViewModel exposes cancel() from the flow", Regex("""fun cancel\(\)\s*=\s*flow\.cancel\(\)""").containsMatchIn(vm))
    }
}
