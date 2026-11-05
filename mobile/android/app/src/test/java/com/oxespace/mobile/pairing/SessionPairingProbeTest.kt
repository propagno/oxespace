package com.oxespace.mobile.pairing

import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.SessionEnd
import com.oxespace.mobile.protocol.session.SessionLink
import com.oxespace.mobile.protocol.session.SessionState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** P3: a fresh pairing is checked by signing in once, with one redial in a short grace (Orca's direct probe). */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionPairingProbeTest {
    private val desktop = PairedDesktop("dev-9", "192.168.15.158", 47321, "f".repeat(64), "Studio", "alias-1")

    private class FakeLink : SessionLink {
        override val state = MutableStateFlow<SessionState>(SessionState.Opening)
        override val connectedHost: String? = null
        var connected = 0
        var closed = 0
        override fun connect() { connected++ }
        override fun close() { closed++ }
    }

    private object Keys : DeviceKeys {
        override fun publicKeySpki() = ByteArray(91)
        override fun sign(data: ByteArray) = ByteArray(72)
        override fun delete() {}
    }

    private fun probeWith(links: MutableList<FakeLink>) =
        SessionPairingProbe(linkFor = { target: DesktopTarget, _ -> assertEquals("dev-9", target.deviceId); FakeLink().also { links += it } })

    @Test
    fun aSessionThatSignsInIsOkAndIsClosedAfter() = runTest {
        val links = mutableListOf<FakeLink>()
        var result: ProbeResult? = null
        launch { result = probeWith(links).probe(desktop, Keys) }
        runCurrent()
        links.single().state.value = SessionState.Authenticating
        links.single().state.value = SessionState.Ready("Studio")
        runCurrent()
        assertEquals(ProbeResult.Ok, result)
        assertEquals(1, links.single().closed)
    }

    @Test
    fun aDeadNetworkTimesOutWithinItsBound() = runTest {
        val links = mutableListOf<FakeLink>()
        var result: ProbeResult? = null
        launch { result = probeWith(links).probe(desktop, Keys) }
        advanceTimeBy(8_001); runCurrent()
        assertEquals(ProbeResult.TimedOut, result)
        assertEquals(1, links.size)
    }

    @Test
    fun aFirstCloseGetsOneRedialThatCanSignIn() = runTest {
        val links = mutableListOf<FakeLink>()
        var result: ProbeResult? = null
        launch { result = probeWith(links).probe(desktop, Keys) }
        runCurrent()
        links[0].state.value = SessionState.Ended(SessionEnd.CLOSED)
        advanceTimeBy(501); runCurrent()
        assertEquals(2, links.size)
        // The desktop answers 1.5 s into the redial: the grace re-arms from there, so a sign-in at 3 s (past the
        // first 2 s) still counts.
        advanceTimeBy(1_500); runCurrent()
        links[1].state.value = SessionState.Authenticating
        advanceTimeBy(1_500); runCurrent()
        links[1].state.value = SessionState.Ready(null)
        runCurrent()
        assertEquals(ProbeResult.Ok, result)
    }

    @Test
    fun aRedialThatClosesAgainIsUnreachableAndARefusalSaysSo() = runTest {
        val links = mutableListOf<FakeLink>()
        var result: ProbeResult? = null
        launch { result = probeWith(links).probe(desktop, Keys) }
        runCurrent()
        links[0].state.value = SessionState.Ended(SessionEnd.CLOSED)
        advanceTimeBy(501); runCurrent()
        links[1].state.value = SessionState.Ended(SessionEnd.CLOSED)
        runCurrent()
        assertEquals(ProbeResult.Closed, result)

        val refused = mutableListOf<FakeLink>()
        launch { result = probeWith(refused).probe(desktop, Keys) }
        runCurrent()
        refused[0].state.value = SessionState.Ended(SessionEnd.UNAUTHENTICATED)
        runCurrent()
        assertEquals(ProbeResult.Refused(SessionEnd.UNAUTHENTICATED), result)
    }
}
