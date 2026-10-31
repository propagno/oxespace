package com.oxespace.mobile.session

import com.oxespace.mobile.pairing.DeviceKeys
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.pairing.PairedDesktopStore
import com.oxespace.mobile.protocol.session.DesktopTarget
import com.oxespace.mobile.protocol.session.SessionEnd
import com.oxespace.mobile.protocol.session.SessionLink
import com.oxespace.mobile.protocol.session.SessionState
import com.oxespace.mobile.protocol.session.TokenHolder
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
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

    private class Harness(scope: TestScope, desktop: PairedDesktop?) {
        val store = FakeStore(desktop)
        val keys = FakeKeys()
        val links = mutableListOf<FakeLink>()
        val controller = DesktopSessionController(
            scope = TestScope(UnconfinedTestDispatcher(scope.testScheduler)),
            store = store,
            keysFor = { keys },
            linkFor = { target, _, _: TokenHolder -> FakeLink(target).also { links += it } },
        )
        val link get() = links.last()
    }

    @Test
    fun connectsToThePairedDesktopAndRemembersWhereItAnswered() = runTest {
        val harness = Harness(this, paired.copy(manualHost = "10.0.0.7"))
        harness.controller.start()
        assertEquals(listOf("192.168.0.12", "10.0.0.7"), harness.link.target.hosts)
        assertEquals(1, harness.link.connected)
        assertEquals(DesktopStatus.Connecting(harness.store.desktop!!), harness.controller.status.value)
        harness.link.connectedHost = "10.0.0.7"
        harness.link.state.value = SessionState.Ready("Studio")
        assertTrue(harness.controller.status.value is DesktopStatus.Connected)
        assertEquals("10.0.0.7", harness.store.desktop!!.host)
        // A second start while connected doesn't open another session.
        harness.controller.start()
        assertEquals(1, harness.links.size)
    }

    @Test
    fun forgetsEverythingWhenTheDesktopRevokesThePhone() = runTest {
        val harness = Harness(this, paired)
        harness.controller.start()
        harness.link.state.value = SessionState.Ready(null)
        harness.link.state.value = SessionState.Ended(SessionEnd.REVOKED)
        assertEquals(DesktopStatus.Unpaired(revokedFrom = "Studio", revoked = true), harness.controller.status.value)
        assertTrue(harness.keys.deleted)
        assertNull(harness.store.desktop)
        // Nothing is left to reconnect to.
        harness.controller.start()
        assertEquals(1, harness.links.size)
    }

    @Test
    fun saysWhyTheSessionEnded() = runTest {
        val cases = mapOf(
            SessionEnd.CLOSED to DesktopStatus.Unreachable(paired),
            SessionEnd.UNSUPPORTED_VERSION to DesktopStatus.Incompatible(paired),
            SessionEnd.PROTOCOL to DesktopStatus.Incompatible(paired),
            SessionEnd.UNAUTHENTICATED to DesktopStatus.NotAccepted(paired),
        )
        for ((end, status) in cases) {
            val harness = Harness(this, paired)
            harness.controller.start()
            harness.link.state.value = SessionState.Ended(end)
            assertEquals(end.toString(), status, harness.controller.status.value)
            assertFalse(end.toString(), harness.keys.deleted)
            // Retrying opens a fresh session.
            harness.controller.retry()
            assertEquals(2, harness.links.size)
        }
    }

    @Test
    fun acceptsOnlyALanAddressTypedByThePerson() = runTest {
        val harness = Harness(this, paired)
        harness.controller.start()
        for (bad in listOf("8.8.8.8", "studio.local", "", "192.168.0.300")) assertFalse(bad, harness.controller.setManualHost(bad))
        assertNull(harness.store.desktop!!.manualHost)
        assertTrue(harness.controller.setManualHost(" 192.168.1.50 "))
        assertEquals("192.168.1.50", harness.store.desktop!!.manualHost)
        assertEquals(listOf("192.168.0.12", "192.168.1.50"), harness.link.target.hosts)
        assertEquals(1, harness.links.first().closed)
    }

    @Test
    fun unpairingDeletesTheKeyAndThePairing() = runTest {
        val harness = Harness(this, paired)
        harness.controller.start()
        harness.controller.unpair()
        assertTrue(harness.keys.deleted)
        assertNull(harness.store.desktop)
        assertEquals(DesktopStatus.Unpaired(), harness.controller.status.value)
        assertEquals(1, harness.link.closed)
    }
}
