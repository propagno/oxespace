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
}
