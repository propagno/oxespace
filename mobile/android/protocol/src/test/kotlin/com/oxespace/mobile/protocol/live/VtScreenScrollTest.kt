package com.oxespace.mobile.protocol.live

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A5 (OXE program oxespace-152-mobile, phase F2, Jira OXE-18, T18-e). Written
 * by the planner; the executor must not edit it. The phone's emulator handles what full-screen CLIs (Codex, vim, less,
 * htop) draw with, as xterm does: a scroll region (DECSTBM), insert/delete line (IL/DL), scroll up/down (SU/SD),
 * reverse index at the top (RI), and LF on the last row of the alternate screen scrolls instead of growing a line.
 * Every case runs on the alternate screen, 20 × 5, filled with rows "1".."5".
 */
class VtScreenScrollTest {
    private val esc = "\u001B"

    private fun filled(): VtScreen = VtScreen().apply {
        reset(20, 5)
        feed("$esc[?1049h$esc[H1\r\n2\r\n3\r\n4\r\n5")
    }

    /** The screen's rows, without the empty rows at the bottom (the screen may or may not keep them). */
    private fun rows(screen: VtScreen): List<String> = screen.text().split('\n').dropLastWhile { it.isEmpty() }

    @Test
    fun theFilledScreenIsFiveRows() {
        assertEquals(listOf("1", "2", "3", "4", "5"), rows(filled()))
    }

    @Test
    fun lineFeedAtTheBottomOfAScrollRegionScrollsOnlyThatRegion() {
        val screen = filled().apply { feed("$esc[2;4r$esc[4;1H\n") }
        assertEquals(listOf("1", "3", "4", "", "5"), rows(screen))
    }

    @Test
    fun insertLinePushesTheRowsBelowDownAndDropsTheLast() {
        val screen = filled().apply { feed("$esc[2;1H$esc[L") }
        assertEquals(listOf("1", "", "2", "3", "4"), rows(screen))
    }

    @Test
    fun deleteLinePullsTheRowsBelowUp() {
        val screen = filled().apply { feed("$esc[2;1H$esc[M") }
        assertEquals(listOf("1", "3", "4", "5"), rows(screen))
    }

    @Test
    fun scrollUpAndScrollDownMoveTheWholeScreen() {
        assertEquals(listOf("2", "3", "4", "5"), rows(filled().apply { feed("$esc[S") }))
        assertEquals(listOf("", "1", "2", "3", "4"), rows(filled().apply { feed("$esc[T") }))
    }

    @Test
    fun reverseIndexAtTheTopScrollsDown() {
        val screen = filled().apply { feed("$esc[1;1H${esc}M") }
        assertEquals(listOf("", "1", "2", "3", "4"), rows(screen))
    }

    @Test
    fun lineFeedOnTheLastRowOfTheAlternateScreenKeepsFiveRows() {
        val screen = filled().apply { feed("\r\n6") }
        assertEquals(listOf("2", "3", "4", "5", "6"), rows(screen))
        assertTrue(screen.text().split('\n').size <= 5)
    }
}
