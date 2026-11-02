package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.live.CommandResult
import org.junit.Assert.assertEquals
import org.junit.Test

class ClientIdTest {
    private fun after(result: CommandResult) = clientIdAfter(result, "same") { "new" }

    @Test
    fun keepsTheIdWhileTheMessagesFateIsUnknown() {
        assertEquals("same", after(CommandResult.NoAnswer))
        assertEquals("same", after(CommandResult.Offline))
    }

    @Test
    fun startsANewMessageAfterItWentThroughOrWasRefused() {
        assertEquals("new", after(CommandResult.Done(null)))
        // The desktop would replay the refusal for the same id; the person's retry is a new message.
        assertEquals("new", after(CommandResult.Refused(RemoteErrorCode.RATE_LIMITED, 500)))
    }

    @Test
    fun aResendIsOnlyTheUnsentMessageAsItWent() {
        val unsent = Outgoing("deploy to staging", steer = false)
        // Unchanged: it goes again as a new turn, even if the conversation started running meanwhile.
        assertEquals(unsent, resendOf(unsent, "deploy to staging"))
        assertEquals(unsent, outgoingFor(unsent, "deploy to staging", steerNow = true))
        // Edited after the silence: nothing goes by itself, and a tap sends the edit in the current mode.
        assertEquals(null, resendOf(unsent, "deploy to production"))
        assertEquals(Outgoing("deploy to production", steer = true), outgoingFor(unsent, "deploy to production", steerNow = true))
        assertEquals(null, resendOf(null, "anything"))
        assertEquals(null, resendOf(Outgoing("  ", steer = false), "  "))
    }
}
