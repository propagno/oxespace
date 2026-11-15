package com.oxespace.mobile.ui.live

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A6 (OXE program oxespace-152-mobile, phase F2, Jira OXE-18, T18-c and
 * T18-d). Written by the planner; the executor must not edit it.
 * T18-c: the phone can send a bare Enter (to confirm a CLI menu choice or "press Enter"): an Enter key, and Send with an
 * empty field sends Enter alone.
 * T18-d: a typed line and its Enter go as separate writes, Enter at least TERMINAL_ENTER_DELAY_MS (>= 80 ms) later, as
 * the desktop's TerminalManager.submit does, so Claude Code and Codex submit the line instead of taking it as a paste.
 */
class TerminalEnterTest {
    @Test
    fun anEnterKeySendsCarriageReturn() {
        val enter = TerminalKey.entries.single { it.name == "ENTER" }
        assertEquals("\r", enter.bytes)
    }

    @Test
    fun sendWithAnEmptyFieldSendsEnterAlone() {
        assertEquals(listOf("\r"), terminalPieces(""))
    }

    @Test
    fun aLineAndItsEnterAreSeparatePieces() {
        assertEquals(listOf("hi", "\r"), terminalPieces("hi"))
        assertEquals(listOf(1_000, 1_000, 500, 1), terminalPieces("x".repeat(2_500)).map { it.length })
    }

    @Test
    fun whatIsLeftAfterAPartialSendHasNoEnter() {
        val pieces = terminalPieces("a".repeat(1_000) + "b".repeat(200))
        assertEquals("b".repeat(200), unsentText(pieces, sent = 1))
        assertEquals("", unsentText(pieces, sent = 2))
    }

    @Test
    fun enterWaitsAtLeastEightyMillisecondsAfterTheText() {
        assertTrue(TERMINAL_ENTER_DELAY_MS >= 80L)
    }
}
