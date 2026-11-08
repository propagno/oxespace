package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.live.CommandResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A47 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-phone-agents-steer.md (#689) T-P2.2: the composer while the agent works, as DESIGN approved
 * it (M5), and HML's "finished between the tap and the send" case (M10).
 */
class ComposerModeTest {
    @Test
    fun whileTheAgentWorksAndCanTakeItTheFieldShowsStopAndSendTheInstruction() {
        val mode = composerMode(running = true, canSteer = true)
        assertEquals(listOf(ComposerControl.STOP, ComposerControl.STEER), mode.controls)
        assertFalse(mode.queuedPlaceholder)
    }

    @Test
    fun whileTheAgentWorksAndCannotTakeItSendQueuesWithItsPlaceholder() {
        val mode = composerMode(running = true, canSteer = false)
        assertEquals(listOf(ComposerControl.STOP, ComposerControl.SEND), mode.controls)
        assertTrue(mode.queuedPlaceholder)
    }

    @Test
    fun whenTheAgentIsNotWorkingItIsThe14ComposerWithSendOnly() {
        for (canSteer in listOf(true, false)) {
            val mode = composerMode(running = false, canSteer = canSteer)
            assertEquals("$canSteer", listOf(ComposerControl.SEND), mode.controls)
            assertFalse("$canSteer", mode.queuedPlaceholder)
        }
    }

    @Test
    fun aSteerRefusedBecauseTheAgentFinishedSaysSoInItsOwnWords() {
        // The desktop refuses a steer with `forbidden` once the thread is no longer running (commands.ts). Today that
        // reads as the terminal's "not shared" message, which is wrong for a steer.
        val refused = CommandResult.Refused(RemoteErrorCode.FORBIDDEN)
        assertEquals(R.string.composer_steer_finished_before, steerMessage(refused))
        assertNotEquals(R.string.terminal_input_not_shared, steerMessage(refused))
        assertNull(steerMessage(CommandResult.Done(null)))
        // Everything else reads as for any command.
        for (other in listOf(CommandResult.Offline, CommandResult.NoAnswer, CommandResult.Refused(RemoteErrorCode.RATE_LIMITED))) {
            assertEquals("$other", commandMessage(other), steerMessage(other))
        }
    }

    @Test
    fun aRefusedSteerKeepsNothingToResendSoItNeverReachesALaterTurn() {
        val steer = Outgoing("also add tests", steer = true)
        // Refused or done: nothing is left to resend after a reconnection.
        assertNull(unsentAfter(CommandResult.Refused(RemoteErrorCode.FORBIDDEN), steer))
        assertNull(unsentAfter(CommandResult.Done(null), steer))
        assertNull(resendOf(unsentAfter(CommandResult.Refused(RemoteErrorCode.FORBIDDEN), steer), steer.text))
        // Fate unknown: it goes again as it first went, a steer, which the desktop refuses if the turn is over.
        assertEquals(steer, unsentAfter(CommandResult.NoAnswer, steer))
        assertEquals(steer, unsentAfter(CommandResult.Offline, steer))
    }

    @Test
    fun theFieldKeepsTheTextUnlessItWentThrough() {
        assertTrue(keepsText(CommandResult.Refused(RemoteErrorCode.FORBIDDEN)))
        assertTrue(keepsText(CommandResult.Offline))
        assertTrue(keepsText(CommandResult.NoAnswer))
        assertFalse(keepsText(CommandResult.Done(null)))
    }
}
