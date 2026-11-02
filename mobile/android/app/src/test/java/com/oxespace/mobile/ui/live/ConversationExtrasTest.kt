package com.oxespace.mobile.ui.live

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationExtrasTest {
    @Test
    fun `the timer counts on from what the desktop sent, whatever the phone's clock says`() {
        val clock = TurnClock(turnElapsedMs = 120_000, quietMs = 30_000, receivedAt = 5_000_000)
        assertEquals(120_000L, turnElapsed(clock, 5_000_000))
        assertEquals(150_000L, turnElapsed(clock, 5_030_000))
        assertEquals(60_000L, quietFor(clock, 5_030_000))
        // A phone clock behind the arrival never counts backwards.
        assertEquals(120_000L, turnElapsed(clock, 4_000_000))
        assertNull(quietFor(clock.copy(quietMs = null), 5_030_000))
    }

    @Test
    fun `a diff shows only project-relative paths, at most 20 files and 8 KB of patch`() {
        val files = listOf("src/a.ts", "/etc/passwd", "C:/Windows/x", "\\\\host\\share\\x", "../up.ts", "a/../../b", "ok/b.ts", "nul\u0000.ts")
            .map { ToolDiffFile(it, 1, 1) }
        val shown = shownDiff(ToolDiff(files))
        assertEquals(listOf("src/a.ts", "ok/b.ts"), shown.files.map { it.path })
        assertFalse(shown.truncated)

        val many = shownDiff(ToolDiff((1..25).map { ToolDiffFile("f$it.ts", 1, 0) }, patch = "x".repeat(DIFF_MAX_PATCH + 10)))
        assertEquals(DIFF_MAX_FILES, many.files.size)
        assertEquals(DIFF_MAX_PATCH, many.patch!!.length)
        assertTrue(many.truncated)
        assertTrue(shownDiff(ToolDiff(emptyList(), truncated = true)).truncated)
    }

    @Test
    fun `the queue lists at most five and counts the rest`() {
        val preview = (1..7).map { QueuedMessage("q$it", "message $it") }
        val (shown, more) = shownQueue(preview, queued = 9)
        assertEquals(5, shown.size)
        assertEquals(4, more)
        assertEquals(0, shownQueue(preview.take(2), queued = 2).second)
    }
}
