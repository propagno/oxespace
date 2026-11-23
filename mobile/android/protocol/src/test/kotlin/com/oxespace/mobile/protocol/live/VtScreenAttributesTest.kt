package com.oxespace.mobile.protocol.live

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * OXE-384 (a): a full-screen CLI marks its selection with reverse video (SGR 7) or a background color, dims hints
 * (SGR 2), underlines links (SGR 4) and puts the cursor where input goes. The screen kept none of that, so a menu in
 * Claude Code, fzf, vim or htop showed no selection. These fixtures are written here, never captured from a terminal.
 */
class VtScreenAttributesTest {
    private val esc = "\u001B"

    private fun runOf(screen: VtScreen, row: Int, text: String): VtRun {
        val line = screen.lines()[row]
        return line.runs.first { line.text.substring(it.start, it.end) == text }
    }

    @Test
    fun `reverse video, dim, underline and background colors are kept per run`() {
        val screen = VtScreen()
        screen.feed("$esc[7m> main$esc[27m dev  $esc[2mhint$esc[22m $esc[4mlink$esc[24m $esc[41mred$esc[49m $esc[104mblue$esc[0m end")
        assertEquals(VtRun(0, 6, null, false, inverse = true), runOf(screen, 0, "> main"))
        assertEquals(VtRun(12, 16, null, false, dim = true), runOf(screen, 0, "hint"))
        assertEquals(VtRun(17, 21, null, false, underline = true), runOf(screen, 0, "link"))
        assertEquals(VtRun(22, 25, null, false, background = 1), runOf(screen, 0, "red"))
        assertEquals(VtRun(26, 30, null, false, background = 12), runOf(screen, 0, "blue"))
        // The plain text between them has the default style.
        assertEquals(VtRun(6, 12, null, false), runOf(screen, 0, " dev  "))
        assertEquals(VtRun(30, 34, null, false), runOf(screen, 0, " end"))
    }

    @Test
    fun `SGR 22 ends bold and dim, SGR 0 ends everything, and colors combine with the attributes`() {
        val screen = VtScreen()
        screen.feed("$esc[1;2;7;32;43mall$esc[22mnorm$esc[0mplain")
        assertEquals(VtRun(0, 3, 2, true, background = 3, inverse = true, dim = true), runOf(screen, 0, "all"))
        assertEquals(VtRun(3, 7, 2, false, background = 3, inverse = true), runOf(screen, 0, "norm"))
        assertEquals(VtRun(7, 12, null, false), runOf(screen, 0, "plain"))
    }

    @Test
    fun `256-color and true-color backgrounds skip their arguments and keep the default`() {
        val screen = VtScreen()
        screen.feed("$esc[41m$esc[48;5;196mA$esc[48;2;10;20;30mB$esc[38;5;82;7mC")
        assertEquals("ABC", screen.text())
        assertEquals(VtRun(0, 2, null, false), runOf(screen, 0, "AB"))
        assertEquals(VtRun(2, 3, null, false, inverse = true), runOf(screen, 0, "C"))
    }

    @Test
    fun `the cursor is where the next character goes, on the screen the view shows`() {
        val screen = VtScreen()
        screen.feed("ab\r\ncd")
        assertEquals(VtCursor(1, 2), screen.cursor())
        screen.feed("$esc[1;2H")
        assertEquals(VtCursor(0, 1), screen.cursor())

        // A full-screen program: the cursor is on the alternate screen, hidden while it draws, shown at its input.
        screen.feed("$esc[?1049h$esc[?25l$esc[3;5Hx")
        assertNull(screen.cursor())
        screen.feed("$esc[?25h")
        assertEquals(VtCursor(2, 5), screen.cursor())
        screen.feed("$esc[?1049l")
        assertEquals(VtCursor(0, 1), screen.cursor())
    }

    @Test
    fun `with a known width the cursor stays on the last column while a wrap is pending`() {
        val screen = VtScreen()
        screen.reset(4, 3)
        screen.feed("abcd")
        assertEquals(VtCursor(0, 3), screen.cursor())
        screen.feed("e")
        assertEquals(VtCursor(1, 1), screen.cursor())
        // A clear moves the old screen into the scrollback: the cursor is at the top of the new one, its last line.
        screen.feed("$esc[2J$esc[H")
        assertEquals(VtCursor(screen.lines().lastIndex, 0), screen.cursor())
    }
}
