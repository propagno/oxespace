package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteTerminalData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** OXE-384: TerminalBuffer exposes the emulator's cursor for the terminal view to render. */
class TerminalBufferCursorTest {
    private val esc = "\u001B"

    private fun event(data: String) =
        RemoteFrames.json.encodeToJsonElement(RemoteTerminalData.serializer(), RemoteTerminalData(data = data, truncated = false))

    @Test
    fun exposesCursorPositionAndHidesWhenProgramHidesIt() {
        val buffer = TerminalBuffer()
        buffer.onEvent(event("prompt> "))
        assertEquals(VtCursor(0, 8), buffer.cursor())

        buffer.onEvent(event("\r\nnext"))
        assertEquals(VtCursor(1, 4), buffer.cursor())

        // DECTCEM hide (?25l) and show (?25h)
        buffer.onEvent(event("$esc[?25l"))
        assertNull(buffer.cursor())

        buffer.onEvent(event("$esc[?25h"))
        assertEquals(VtCursor(1, 4), buffer.cursor())
    }

    @Test
    fun hidingPaneOnDesktopResetsCursorToOrigin() {
        val buffer = TerminalBuffer()
        buffer.onEvent(event("line1\r\nline2"))
        assertEquals(VtCursor(1, 5), buffer.cursor())

        buffer.onEnded(RemoteErrorCode.NOT_FOUND, PANE_HIDDEN_REASON)
        assertEquals(VtCursor(0, 0), buffer.cursor())
    }
}
