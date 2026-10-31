package com.oxespace.mobile.ui.terminal

import org.junit.Assert.assertEquals
import org.junit.Test

class AnsiTest {
    private val esc = "\u001B"

    @Test
    fun keepsColorsAndBoldAndMergesRunsOfTheSameStyle() {
        val spans = Ansi.parse("plain $esc[1;32mok$esc[0m and $esc[91merror$esc[39m!")
        assertEquals(
            listOf(AnsiSpan("plain "), AnsiSpan("ok", color = 2, bold = true), AnsiSpan(" and "), AnsiSpan("error", color = 9), AnsiSpan("!")),
            spans,
        )
    }

    @Test
    fun dropsCursorMovesTitlesAndLinksButKeepsTheirText() {
        val spans = Ansi.parse("$esc[2J$esc[H$esc]0;title$BEL" + "go $esc]8;;https://x$esc\\link$esc]8;;$esc\\ end")
        assertEquals("go link end", spans.joinToString("") { it.text })
    }

    @Test
    fun aCarriageReturnRewritesTheLineLikeAProgressBar() {
        val spans = Ansi.parse("build\n 10%\r 50%\r100%\ndone\r\n")
        assertEquals("build\n100%\ndone\n", spans.joinToString("") { it.text })
    }

    @Test
    fun ignoresExtendedColorsWithoutLosingText() {
        val spans = Ansi.parse("$esc[38;5;208morange$esc[38;2;1;2;3mtrue$esc[0m")
        assertEquals(listOf(AnsiSpan("orangetrue")), spans)
    }

    private companion object {
        const val BEL = "\u0007"
    }
}
