package com.oxespace.mobile.approval

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PresenceGateTest {
    private val asked = mutableListOf<PresenceReason>()
    private val prompted = mutableListOf<Boolean>()
    private val actions = mutableListOf<String>()

    private fun gate(presence: Presence) = PresenceGate { reason, ask -> asked += reason; prompted += ask; presence }

    @Test
    fun runsTheActionOnlyOnceThePersonIsConfirmed() = runBlocking {
        val outcome = gate(Presence.CONFIRMED).run(PresenceReason.SEND) { actions += "send"; 42 }
        assertEquals(Gated.Done(42), outcome)
        assertEquals(listOf(PresenceReason.SEND), asked)
        assertEquals(listOf("send"), actions)
    }

    @Test
    fun runsNothingWhenNotConfirmedOrWithoutAScreenLock() = runBlocking {
        assertEquals(Gated.Blocked(Presence.NOT_CONFIRMED), gate(Presence.NOT_CONFIRMED).run(PresenceReason.TYPE) { actions += "type" })
        assertEquals(Gated.Blocked(Presence.NO_SCREEN_LOCK), gate(Presence.NO_SCREEN_LOCK).run(PresenceReason.SEND) { actions += "send" })
        assertTrue(actions.isEmpty())
        assertEquals(listOf(PresenceReason.TYPE, PresenceReason.SEND), asked)
    }

    @Test
    fun anAutomaticResendOnlyChecksTheWindowAndNeverPrompts() = runBlocking {
        assertEquals(Gated.Blocked(Presence.NOT_CONFIRMED), gate(Presence.NOT_CONFIRMED).run(PresenceReason.SEND, ask = false) { actions += "resend" })
        gate(Presence.CONFIRMED).run(PresenceReason.SEND) { actions += "send" }
        assertEquals(listOf(false, true), prompted)
        assertEquals(listOf("send"), actions)
    }
}
