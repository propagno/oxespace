package com.oxespace.mobile.protocol.live

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T97: the phone keeps a screen, not the raw stream. These fixtures are built here and never captured from anyone's
 * terminal. Each one replays how the program writes to its PTY:
 * - Ink's log-update (Claude Code): erase the previous frame line by line with ESC[2K and ESC[1A, then ESC[G, then
 *   write the new frame;
 * - ratatui (Codex): the alternate screen, the cursor hidden, cells placed with CUP;
 * - a plain shell.
 * Newlines are `\r\n`, as the PTY's onlcr writes them.
 */
class VtScreenTest {
    private val esc = "\u001B"

    /** ansi-escapes eraseLines(count), as log-update calls it before every frame. */
    private fun eraseLines(count: Int): String = buildString {
        for (i in 0 until count) { append("$esc[2K"); if (i < count - 1) append("$esc[1A") }
        if (count > 0) append("$esc[G")
    }

    /** log-update: each frame is the previous one erased, then the new one with a trailing newline. */
    private fun inkFrames(frames: List<String>): String = buildString {
        var previous = 0
        for (frame in frames) {
            val output = "$frame\n"
            append(eraseLines(previous)).append(output.replace("\n", "\r\n"))
            previous = output.split('\n').size
        }
    }

    private val box = { prompt: String, status: String ->
        "╭──────────────────────╮\n│ > $prompt${" ".repeat(18 - prompt.length)} │\n╰──────────────────────╯\n  $status"
    }

    private val claudeSession = "$ claude\r\n" + inkFrames(
        listOf(
            "✻ Thinking…\n" + box("", "? for shortcuts"),
            "✻ Thinking… (3s)\n" + box("", "? for shortcuts"),
            "● Read 2 files\n✻ Writing tests… (8s)\n" + box("add a", "esc to interrupt"),
        ),
    )

    @Test
    fun anInkTuiShowsOnlyItsLatestFrameUnderTheShellLine() {
        val screen = VtScreen().apply { feed(claudeSession) }
        assertEquals(
            listOf(
                "$ claude",
                "● Read 2 files",
                "✻ Writing tests… (8s)",
                "╭──────────────────────╮",
                "│ > add a              │",
                "╰──────────────────────╯",
                "  esc to interrupt",
                "",
            ),
            screen.text().split('\n'),
        )
    }

    @Test
    fun anyChunkSplitGivesTheSameScreenAsTheWholeStream() {
        val whole = VtScreen().apply { feed(claudeSession) }.text()
        for (cut in 1 until claudeSession.length) {
            val screen = VtScreen()
            screen.feed(claudeSession.substring(0, cut))
            screen.feed(claudeSession.substring(cut))
            assertEquals("split at $cut", whole, screen.text())
        }
    }

    private val codexSession = "$ codex\r\n" +
        "$esc[?1049h$esc[?25l$esc[2J" +
        "$esc[1;1H› Explain this repo$esc[2;1H" + "─".repeat(20) +
        "$esc[3;1H  Working (2s • esc to interrupt)" +
        "$esc[3;12H5" + // a cell update in place: 2s → 5s
        "$esc[5;3H$esc[1;36mcodex$esc[0m ready"

    @Test
    fun aRatatuiTuiDrawsOnTheAlternateScreenAndGivesTheShellBackOnExit() {
        val screen = VtScreen().apply { feed(codexSession) }
        assertEquals(
            listOf("› Explain this repo", "─".repeat(20), "  Working (5s • esc to interrupt)", "", "  codex ready"),
            screen.text().split('\n'),
        )
        val codex = screen.lines()[4].runs.first { screen.lines()[4].text.substring(it.start, it.end) == "codex" }
        assertEquals(6, codex.color)
        assertTrue(codex.bold)

        screen.feed("$esc[?25h$esc[?1049l\$ ")
        assertEquals(listOf("$ codex", "$"), screen.text().split('\n'))
        assertEquals("$ ", screen.lines()[1].text)
    }

    @Test
    fun aPlainShellReadsAsBeforeWithProgressBarsRewrittenInPlace() {
        val screen = VtScreen().apply { feed("$ npm i\r\n 10% $esc[K\r 50% $esc[K\r100%$esc[K\r\nadded 3 packages\r\n$ ") }
        assertEquals(listOf("$ npm i", "100%", "added 3 packages", "$"), screen.text().split('\n'))
    }

    @Test
    fun keepsColorsAndBoldAndDropsTitlesLinksAndExtendedColors() {
        val screen = VtScreen().apply {
            feed("plain $esc[1;32mok$esc[0m $esc]0;title\u0007$esc]8;;https://x$esc\\link$esc]8;;$esc\\ $esc[38;5;208morange$esc[38;2;1;2;3mtrue$esc[0m")
        }
        val line = screen.lines().single()
        assertEquals("plain ok link orangetrue", line.text)
        assertEquals(listOf(VtRun(0, 6, null, false), VtRun(6, 8, 2, true), VtRun(8, 24, null, false)), line.runs)
    }

    @Test
    fun clearingTheScreenAndTheScrollbackLeavesOnlyWhatFollows() {
        // Claude Code's /clear: 2J, 3J, home.
        val screen = VtScreen().apply { feed("old 1\r\nold 2\r\n$esc[2J$esc[3J${esc}[Hfresh\r\n") }
        assertEquals(listOf("fresh", ""), screen.text().split('\n'))
    }

    @Test
    fun aClearedScreenGoesToTheScrollbackWithout3J() {
        val screen = VtScreen().apply { feed("before\r\n$esc[2J${esc}[Hafter") }
        assertEquals(listOf("before", "", "after"), screen.text().split('\n'))
    }

    @Test
    fun staysWithinItsCapacityDroppingWholeLinesFromTheTop() {
        val screen = VtScreen(capacity = 20)
        screen.feed("\$ ls\r\na b\r\n")
        screen.feed("TOKEN=[hidden]\r\n")
        assertEquals("a b\nTOKEN=[hidden]\n", screen.text())
        repeat(1_000) { screen.feed("line $it\r\n") }
        assertTrue(screen.text().length <= 20)
        assertTrue(screen.text().contains("line 999"))
    }

    @Test
    fun unchangedLinesComeBackAsTheSameObjects() {
        val screen = VtScreen().apply { feed("one\r\ntwo\r\n") }
        val first = screen.lines()
        screen.feed("three")
        val second = screen.lines()
        assertTrue(first[0] === second[0])
        assertTrue(first[1] === second[1])
        assertEquals("three", second[2].text)
    }

    @Test
    fun cursorSaveAndRestoreAndLineEdits() {
        // Save after "abcdef", go down, come back, step left 3, insert a blank, type over it, delete two.
        val screen = VtScreen().apply { feed("abcdef${esc}7\r\nxyz${esc}8$esc[3D$esc[1@!$esc[2P") }
        assertEquals(listOf("abc!f", "xyz"), screen.text().split('\n'))
    }
}
