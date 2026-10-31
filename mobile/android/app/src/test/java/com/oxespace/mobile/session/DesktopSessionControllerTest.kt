package com.oxespace.mobile.session

import com.oxespace.mobile.pairing.DeviceKeys
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.pairing.PairedDesktopStore
import com.oxespace.mobile.protocol.session.Backoff
import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.SessionEnd
import com.oxespace.mobile.protocol.session.SessionLink
import com.oxespace.mobile.protocol.session.SessionState
import com.oxespace.mobile.protocol.session.TokenHolder
import kotlin.random.Random
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DesktopSessionControllerTest {
    private val paired = PairedDesktop("dev-1", "192.168.0.12", 7443, "d".repeat(64), "Studio", "alias-1")

    private class FakeLink(val target: DesktopTarget) : SessionLink {
        override val state = MutableStateFlow<SessionState>(SessionState.Opening)
        override var connectedHost: String? = null
        var connected = 0
        var closed = 0
        override fun connect() { connected++ }
        override fun close() { closed++ }
    }

    private class FakeKeys : DeviceKeys {
        var deleted = false
        override fun publicKeySpki() = ByteArray(91)
        override fun sign(data: ByteArray) = ByteArray(72)
        override fun delete() { deleted = true }
    }

    private class FakeStore(var desktop: PairedDesktop?) : PairedDesktopStore {
        override fun load() = desktop
        override fun save(desktop: PairedDesktop) { this.desktop = desktop }
        override fun clear() { desktop = null }
    }

    /** Waits the whole step every time, so the test knows each wait: 1 s, 2 s, 4 s… */
    private val longestWait = object : Random() {
        override fun nextBits(bitCount: Int) = 0
        override fun nextLong(until: Long) = until - 1
    }

    private class Harness(scope: TestScope, desktop: PairedDesktop?, random: Random) {
        val store = FakeStore(desktop)
        val keys = FakeKeys()
        val links = mutableListOf<FakeLink>()
        val lan = MutableStateFlow(true)
        val controller = DesktopSessionController(
            scope = scope.backgroundScope.let { TestScope(UnconfinedTestDispatcher(scope.testScheduler)) },
            store = store,
            keysFor = { keys },
            linkFor = { target, _, _: TokenHolder -> FakeLink(target).also { links += it } },
            onLan = lan,
            backoff = Backoff(baseMs = 1_000, maxMs = 8_000, random = random),
        )
        val link get() = links.last()
    }

    private fun TestScope.harness(desktop: PairedDesktop? = paired) = Harness(this, desktop, longestWait)

    @Test
    fun connectsToThePairedDesktopAndRemembersWhereItAnswered() = runTest {
        val h = harness(paired.copy(manualHost = "10.0.0.7"))
        h.controller.start()
        assertEquals(listOf("192.168.0.12", "10.0.0.7"), h.link.target.hosts)
        assertEquals(DesktopStatus.Connecting(h.store.desktop!!), h.controller.status.value)
        h.link.connectedHost = "10.0.0.7"
        h.link.state.value = SessionState.Ready("Studio")
        assertTrue(h.controller.status.value is DesktopStatus.Connected)
        assertEquals("10.0.0.7", h.store.desktop!!.host)
        h.controller.start()
        assertEquals("a second start doesn't open another session", 1, h.links.size)
    }

    @Test
    fun aDroppedLiveSessionReconnectsAtOnce() = runTest {
        val h = harness()
        h.controller.start()
        h.link.state.value = SessionState.Ready(null)
        h.link.state.value = SessionState.Ended(SessionEnd.CLOSED)
        assertEquals(DesktopStatus.Reconnecting(paired), h.controller.status.value)
        assertEquals(2, h.links.size)
        assertEquals(1, h.link.connected)
    }

    @Test
    fun anUnansweringDesktopIsRetriedWithGrowingWaits() = runTest {
        val h = harness()
        h.controller.start()
        h.link.state.value = SessionState.Ended(SessionEnd.CLOSED)
        assertEquals(DesktopStatus.Unreachable(paired, 1_000), h.controller.status.value)
        advanceTimeBy(999); runCurrent()
        assertEquals(1, h.links.size)
        advanceTimeBy(1); runCurrent()
        assertEquals(2, h.links.size)
        h.link.state.value = SessionState.Ended(SessionEnd.CLOSED)
        assertEquals(DesktopStatus.Unreachable(paired, 2_000), h.controller.status.value)
        advanceTimeBy(2_000); runCurrent()
        h.link.state.value = SessionState.Ended(SessionEnd.CLOSED)
        assertEquals(DesktopStatus.Unreachable(paired, 4_000), h.controller.status.value)
        // Once it answers, the next drop starts over.
        advanceTimeBy(4_000); runCurrent()
        h.link.state.value = SessionState.Ready(null)
        h.link.state.value = SessionState.Ended(SessionEnd.CLOSED)
        h.link.state.value = SessionState.Ended(SessionEnd.CLOSED)
        assertEquals(DesktopStatus.Unreachable(paired, 1_000), h.controller.status.value)
    }

    @Test
    fun tryingNowSkipsTheWait() = runTest {
        val h = harness()
        h.controller.start()
        h.link.state.value = SessionState.Ended(SessionEnd.CLOSED)
        h.controller.retry()
        assertEquals(2, h.links.size)
        advanceTimeBy(5_000); runCurrent()
        assertEquals("the cancelled wait doesn't connect again", 2, h.links.size)
    }

    @Test
    fun pausesOffTheLocalNetworkAndReconnectsWhenItComesBack() = runTest {
        val h = harness()
        h.controller.start()
        h.link.state.value = SessionState.Ready(null)
        h.lan.value = false
        assertEquals(DesktopStatus.OffNetwork(paired), h.controller.status.value)
        assertEquals(1, h.link.closed)
        advanceTimeBy(60_000); runCurrent()
        assertEquals("no attempts on mobile data", 1, h.links.size)
        h.lan.value = true
        assertEquals(2, h.links.size)
        assertEquals(DesktopStatus.Connecting(paired), h.controller.status.value)
    }

    @Test
    fun forgetsEverythingWhenTheDesktopRevokesThePhoneAndNeverRetries() = runTest {
        val h = harness()
        h.controller.start()
        h.link.state.value = SessionState.Ready(null)
        h.link.state.value = SessionState.Ended(SessionEnd.REVOKED)
        assertEquals(DesktopStatus.Unpaired(revokedFrom = "Studio", revoked = true), h.controller.status.value)
        assertTrue(h.keys.deleted)
        assertNull(h.store.desktop)
        advanceTimeBy(120_000); runCurrent()
        h.lan.value = false
        h.lan.value = true
        assertEquals(1, h.links.size)
    }

    @Test
    fun aDesktopThatCannotBeTalkedToIsNotRetried() = runTest {
        for ((end, status) in listOf(
            SessionEnd.UNSUPPORTED_VERSION to DesktopStatus.Incompatible(paired),
            SessionEnd.PROTOCOL to DesktopStatus.Incompatible(paired),
            SessionEnd.UNAUTHENTICATED to DesktopStatus.NotAccepted(paired),
        )) {
            val h = harness()
            h.controller.start()
            h.link.state.value = SessionState.Ended(end)
            assertEquals(end.toString(), status, h.controller.status.value)
            advanceTimeBy(120_000); runCurrent()
            assertEquals(end.toString(), 1, h.links.size)
            assertFalse(h.keys.deleted)
            h.controller.retry()
            assertEquals("the person can still try", 2, h.links.size)
            h.controller.stop()
        }
    }

    @Test
    fun acceptsOnlyALanAddressTypedByThePerson() = runTest {
        val h = harness()
        h.controller.start()
        for (bad in listOf("8.8.8.8", "studio.local", "", "192.168.0.300")) assertFalse(bad, h.controller.setManualHost(bad))
        assertTrue(h.controller.setManualHost(" 192.168.1.50 "))
        assertEquals("192.168.1.50", h.store.desktop!!.manualHost)
        assertEquals(listOf("192.168.0.12", "192.168.1.50"), h.link.target.hosts)
        assertEquals(1, h.links.first().closed)
    }

    @Test
    fun unpairingDeletesTheKeyAndThePairing() = runTest {
        val h = harness()
        h.controller.start()
        h.controller.unpair()
        assertTrue(h.keys.deleted)
        assertNull(h.store.desktop)
        assertEquals(DesktopStatus.Unpaired(), h.controller.status.value)
        assertEquals(1, h.link.closed)
    }
}
