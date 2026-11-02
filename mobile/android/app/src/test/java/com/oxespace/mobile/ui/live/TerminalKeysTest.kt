package com.oxespace.mobile.ui.live

import org.junit.Assert.assertEquals
import org.junit.Test

/** M11: each key sends exactly what xterm sends, and a stored size reads back. */
class TerminalKeysTest {
    @Test
    fun keysSendTheTerminalsBytes() {
        assertEquals(
            mapOf(
                "Esc" to "\u001b", "Tab" to "\t", "⇧Tab" to "\u001b[Z", "Ctrl+C" to "\u0003",
                "↑" to "\u001b[A", "↓" to "\u001b[B", "←" to "\u001b[D", "→" to "\u001b[C",
            ),
            TerminalKey.entries.associate { it.label to it.bytes },
        )
    }

    @Test
    fun aStoredSizeReadsBackAndAnythingElseIsTheDefault() {
        assertEquals(TerminalTextSize.LARGE, terminalTextSize("LARGE"))
        assertEquals(TerminalTextSize.MEDIUM, terminalTextSize(null))
        assertEquals(TerminalTextSize.MEDIUM, terminalTextSize("HUGE"))
    }
}
