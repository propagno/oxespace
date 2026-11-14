package com.oxespace.mobile.ui.live

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalPiecesTest {
    @Test
    fun splitsALineIntoPiecesThenEnterAlone() {
        val pieces = terminalPieces("x".repeat(2_500))
        assertEquals(listOf(1_000, 1_000, 500, 1), pieces.map { it.length })
        assertEquals("\r", pieces.last())
        assertTrue(pieces.dropLast(1).none { it.contains('\r') })
    }

    @Test
    fun keepsOnlyWhatWasNotSentSoARetryDoesNotRepeatIt() {
        val text = "a".repeat(1_000) + "b".repeat(1_000) + "c".repeat(500)
        val pieces = terminalPieces(text)
        // The desktop refused the third piece (rate limit): the first two are in the terminal already.
        assertEquals("c".repeat(500), unsentText(pieces, sent = 2))
        // Only Enter was refused: the text is in the terminal, the field is empty.
        assertEquals("", unsentText(pieces, sent = 3))
        assertEquals(text, unsentText(pieces, sent = 0))
        assertEquals("", unsentText(pieces, sent = pieces.size))
    }
}
