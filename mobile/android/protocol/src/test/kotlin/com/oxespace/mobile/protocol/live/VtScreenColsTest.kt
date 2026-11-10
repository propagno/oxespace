package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrames
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A45 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-phone-terminal.md (#691) T-P3.1, from #623's phone gap: the grid is exactly `cols` wide,
 * as on the desktop, and wraps and clamps the way xterm does. Fixtures are built here, never captured from anyone's
 * terminal. Wide characters (CJK, emoji) take two columns, as xterm counts them.
 */
class VtScreenColsTest {
    private val esc = "\u001B"

    private fun screen(cols: Int, rows: Int = 24) = VtScreen().apply { reset(cols, rows) }

    @Test
    fun aLineLongerThanColsWrapsAtCols() {
        val screen = screen(cols = 10).apply { feed("0123456789ABC") }
        assertEquals(listOf("0123456789", "ABC"), screen.text().split('\n'))
    }

    @Test
    fun theCursorColumnLandsWhereTheDesktopPutIt() {
        val screen = screen(cols = 120).apply { feed("$esc[2;50Hmid") }
        assertEquals(49, screen.text().split('\n')[1].indexOf("mid"))
    }

    @Test
    fun aCursorPlacedPastTheEdgeClampsToTheLastColumn() {
        val screen = screen(cols = 120).apply { feed("$esc[1;200Hx$esc[2;1H$esc[300Gy") }
        val lines = screen.text().split('\n')
        assertEquals(119, lines[0].indexOf('x'))
        assertEquals(119, lines[1].indexOf('y'))
    }

    @Test
    fun noRowIsEverWiderThanCols() {
        val screen = screen(cols = 80)
        val noisy = buildString {
            repeat(50) { i -> append("line $i ").append("=".repeat(i * 7)).append("$esc[${i % 30 + 1};${i * 13 % 200 + 1}H*").append("\r\n") }
        }
        screen.feed(noisy)
        for (line in screen.lines()) assertTrue("${line.text.length}: ${line.text}", line.text.length <= 80)
    }

    @Test
    fun aWideCharacterThatDoesNotFitAtTheLastColumnWrapsWhole() {
        // 中 needs two columns; at column 4 of 5 only one is left, so it goes to the next row, as in xterm.
        assertEquals(listOf("abcd", "中"), screen(cols = 5).apply { feed("abcd中") }.text().split('\n'))
        // Two wide characters fill four columns exactly.
        assertEquals(listOf("中文", "x"), screen(cols = 4).apply { feed("中文x") }.text().split('\n'))
        // An emoji is one code point, two UTF-16 chars and two columns.
        assertEquals(listOf("ab", "😀"), screen(cols = 3).apply { feed("ab😀") }.text().split('\n'))
    }

    @Test
    fun theAlternateScreenWrapsAtColsAndLeavingItGivesTheShellBackIntact() {
        val screen = screen(cols = 10, rows = 4).apply { feed("$ codex\r\n$esc[?1049h$esc[H0123456789ABCDEF") }
        assertEquals(listOf("0123456789", "ABCDEF"), screen.text().split('\n'))
        screen.feed("$esc[?1049l")
        assertEquals("$ codex", screen.text().split('\n').first())
        assertTrue(screen.lines().all { it.text.length <= 10 })
    }

    @Test
    fun withoutColsTheWidthStaysUnboundedAsIn143() {
        // An older desktop sends no snapshot, so no width is known.
        val screen = VtScreen().apply { feed("x".repeat(300)) }
        assertEquals(1, screen.lines().size)
        assertEquals(300, screen.lines().single().text.length)
    }

    private fun page(snapshot: String, cols: Int, rows: Int = 4): JsonElement = RemoteFrames.json.parseToJsonElement(
        """{"data":"","truncated":false,"snapshot":{"ansi":${JsonPrimitive(snapshot)},"cols":$cols,"rows":$rows}}""",
    )

    @Test
    fun aSnapshotSetsTheGridToItsColsAndANewSnapshotFollowsAResize() {
        val terminal = TerminalBuffer()
        assertNull(terminal.cols)
        terminal.onSnapshot(listOf(page("$ ls\r\n" + "y".repeat(130), cols = 120)))
        assertEquals(120, terminal.cols)
        assertEquals(listOf("$ ls", "y".repeat(120), "y".repeat(10)), terminal.output.split('\n'))
        // The pane went from 120 to 80 columns on the desktop: the next snapshot carries the new width.
        terminal.onSnapshot(listOf(page("$ ls\r\n" + "y".repeat(130), cols = 80)))
        assertEquals(80, terminal.cols)
        assertTrue(terminal.lines().all { it.text.length <= 80 })
    }
}
