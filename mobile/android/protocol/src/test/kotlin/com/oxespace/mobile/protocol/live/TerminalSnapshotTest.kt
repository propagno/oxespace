package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrames
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * P4: a terminal opened mid-session shows the desktop's own screen at once. The first snapshot page carries
 * `snapshot: {ansi, cols, rows}`, the desktop's emulator serialized (scrollback, screen, modes, cursor). The phone feeds
 * it once at the pane's height, skips that snapshot's ring pages (the same bytes), then applies events.
 * Fixtures are built here, never captured from anyone's terminal.
 */
class TerminalSnapshotTest {
    private val esc = "\u001B"

    private fun page(data: String, snapshot: String? = null, rows: Int = 4, redacted: Int = 0): JsonElement {
        val snap = snapshot?.let { ""","snapshot":{"ansi":${JsonPrimitive(it)},"cols":80,"rows":$rows}""" } ?: ""
        return RemoteFrames.json.parseToJsonElement("""{"data":${JsonPrimitive(data)},"truncated":false,"redacted":$redacted$snap}""")
    }
    private fun event(data: String) = RemoteFrames.json.parseToJsonElement("""{"data":${JsonPrimitive(data)},"truncated":false}""")

    @Test
    fun aSnapshotIsFedOnceAtThePanesHeightAndItsRingPagesAreSkipped() {
        val ansi = "old 1\r\nold 2\r\nold 3\r\n$ claude\r\n╭───╮\r\n│ > │\r\n╰───╯$esc[3;5H"
        val terminal = TerminalBuffer()
        terminal.onSnapshot(listOf(page("$esc[2K$esc[1Agarbage frame 1", snapshot = ansi, redacted = 1), page("garbage frame 2", redacted = 1)))
        assertEquals("old 1\nold 2\nold 3\n$ claude\n╭───╮\n│ > │\n╰───╯", terminal.output)
        assertEquals(2L, terminal.redacted)
        // The cursor was placed on screen row 3 of 4 (the scrollback above doesn't count), so live bytes land there.
        terminal.onEvent(event("hi"))
        assertEquals("│ > hi", terminal.output.split('\n')[5])
    }

    @Test
    fun aTuiOnTheAlternateScreenOpensOnItAndGivesTheShellBack() {
        val ansi = "$ codex\r\n$esc[?1049h$esc[H› Explain this repo$esc[3;1H  Working (5s)"
        val terminal = TerminalBuffer()
        terminal.onSnapshot(listOf(page("ignored ring", snapshot = ansi, rows = 24)))
        assertEquals("› Explain this repo\n\n  Working (5s)", terminal.output)
        terminal.onEvent(event("$esc[?1049l"))
        assertEquals("$ codex\n", terminal.output)
    }

    @Test
    fun withNoSnapshotTheRingIsReadAsBefore() {
        // A 1.4.2 desktop, or a screen over the frame budget.
        val terminal = TerminalBuffer()
        terminal.onSnapshot(listOf(page("$ ls\r\n"), page("a b\r\n", redacted = 1)))
        assertEquals("$ ls\na b\n", terminal.output)
        assertEquals(1L, terminal.redacted)
    }
}
