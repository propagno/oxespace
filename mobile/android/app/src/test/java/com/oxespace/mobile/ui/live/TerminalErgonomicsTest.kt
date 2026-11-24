package com.oxespace.mobile.ui.live

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.protocol.live.VtLine
import com.oxespace.mobile.protocol.live.VtRun
import com.oxespace.mobile.ui.Samples
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import com.oxespace.mobile.ui.theme.DarkOxeColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * OXE-384: Heavy-user terminal ergonomics — SGR 2/4/7/bg/cursor rendering, sticky Ctrl chords (Ctrl+C/D/L/R/Z),
 * copy line / copy screen helpers, and Latest chip visibility.
 */
class TerminalErgonomicsTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    @Test
    fun stickyCtrlChordsMapToXtermControlBytes() {
        assertEquals(
            mapOf(
                "^C" to "\u0003",
                "^D" to "\u0004",
                "^L" to "\u000c",
                "^R" to "\u0012",
                "^Z" to "\u001a",
            ),
            CtrlChord.entries.associate { it.label to it.bytes },
        )
        assertEquals("\u0003", ctrlBytes('c'))
        assertEquals("\u0004", ctrlBytes('D'))
        assertEquals("\u000c", ctrlBytes('l'))
        assertEquals("\u0012", ctrlBytes('R'))
        assertEquals("\u001a", ctrlBytes('z'))
        assertEquals("\u0000", ctrlBytes('@'))
        assertEquals("\u001b", ctrlBytes('['))
        assertNull(ctrlBytes('5'))
        assertNull(ctrlBytes(' '))
    }

    @Test
    fun stickyCtrlInputInterceptsSingleTypedCharAndIgnoresDeletesOrPastes() {
        assertEquals("\u0004", stickyCtrlInput("", "d"))
        assertEquals("\u000c", stickyCtrlInput("git ", "git l"))
        assertEquals("\u0012", stickyCtrlInput("foo", "fooR"))
        assertEquals("\u001a", stickyCtrlInput("", "z"))
        // Deletion, multi-character paste, or non-control characters do not fire a chord.
        assertNull(stickyCtrlInput("ab", "a"))
        assertNull(stickyCtrlInput("", "dd"))
        assertNull(stickyCtrlInput("", "1"))
    }

    @Test
    fun coloredRendersDimUnderlineInverseBackgroundAndCursor() {
        val line = VtLine(
            text = "dim u inv bg",
            runs = listOf(
                VtRun(0, 3, color = null, bold = false, dim = true),
                VtRun(4, 5, color = 4, bold = false, underline = true),
                VtRun(6, 9, color = null, bold = false, inverse = true),
                VtRun(10, 12, color = 7, bold = true, background = 1),
            ),
        )
        val styled = colored(line, DarkOxeColors, cursorCol = 12)
        // Padded by 1 space for block cursor at end of line.
        assertEquals("dim u inv bg ", styled.text)

        val dimSpan = styled.spanStyles.first { it.start == 0 && it.end == 3 }.item
        assertEquals(DarkOxeColors.termFg.copy(alpha = 0.55f), dimSpan.color)

        val underlineSpan = styled.spanStyles.first { it.start == 4 && it.end == 5 }.item
        assertEquals(DarkOxeColors.ansiBlue, underlineSpan.color)
        assertEquals(TextDecoration.Underline, underlineSpan.textDecoration)

        val inverseSpan = styled.spanStyles.first { it.start == 6 && it.end == 9 }.item
        assertEquals(DarkOxeColors.termBg, inverseSpan.color)
        assertEquals(DarkOxeColors.termFg, inverseSpan.background)

        val bgSpan = styled.spanStyles.first { it.start == 10 && it.end == 12 }.item
        assertEquals(DarkOxeColors.ansiWhite, bgSpan.color)
        assertEquals(DarkOxeColors.ansiRed, bgSpan.background)
        assertEquals(FontWeight.Bold, bgSpan.fontWeight)

        val cursorSpan = styled.spanStyles.last { it.start == 12 && it.end == 13 }.item
        assertEquals(DarkOxeColors.termBg, cursorSpan.color)
        assertEquals(DarkOxeColors.termFg, cursorSpan.background)
    }

    @Test
    fun coloredLeavesPlainTextUnstyledWhenNoCursor() {
        val line = VtLine("plain", listOf(VtRun(0, 5, color = null, bold = false)))
        val styled = colored(line, DarkOxeColors)
        assertEquals("plain", styled.text)
        assertTrue(styled.spanStyles.isEmpty())
    }

    @Test
    fun copyHelpersTrimTrailingWhitespaceAndLatestChipRequiresScrolledUp() {
        val lines = listOf(
            VtLine("echo hi   ", emptyList()),
            VtLine("hi  ", emptyList()),
            VtLine("   ", emptyList()),
        )
        assertEquals("echo hi", terminalLineText(lines[0]))
        assertEquals("echo hi\nhi", terminalScreenText(lines))

        assertFalse(shouldShowLatestChip(follow = true, canScrollForward = false))
        assertFalse(shouldShowLatestChip(follow = true, canScrollForward = true))
        assertFalse(shouldShowLatestChip(follow = false, canScrollForward = false))
        assertTrue(shouldShowLatestChip(follow = false, canScrollForward = true))
    }

    @Test
    fun terminalScreenExposesCopyActionAndStickyCtrlKey() {
        val screen = paparazzi.render {
            TerminalScreen(Samples.pane, Samples.terminal(), LiveStreams().commands, Samples.presence) {}
        }
        val copyButton = screen.buttons().firstOrNull { screen.label(it).contains(screen.string("terminal_copy_screen")) }
        assertNotNull("Copy screen action is exposed in the top bar", copyButton)

        val ctrlButton = screen.buttons().firstOrNull { screen.label(it).contains(screen.string("terminal_key_ctrl")) }
        assertNotNull("Sticky Ctrl key is exposed in the key row", ctrlButton)
    }
}
