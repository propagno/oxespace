package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.RemoteDiffLimits
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteQueuedPreview
import com.oxespace.mobile.protocol.RemoteThreadHeader
import com.oxespace.mobile.protocol.RemoteToolDiff
import com.oxespace.mobile.protocol.RemoteToolDiffFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationExtrasTest {
    private fun header(status: String, elapsed: Long? = 120_000, quiet: Long? = 30_000) = RemoteThreadHeader(
        id = "t1", workspaceId = "w1", title = "Fix the login", provider = "claude", status = status,
        pendingRequests = 0, updatedAt = 0, queued = 0, canSteer = true, turnElapsedMs = elapsed, quietMs = quiet,
    )

    @Test
    fun `the timer counts on from what the desktop sent, whatever the phone's clock says`() {
        val clock = turnClockOf(header("running"), receivedAt = 5_000_000)!!
        assertEquals(120_000L, turnElapsed(clock, 5_000_000))
        assertEquals(150_000L, turnElapsed(clock, 5_030_000))
        assertEquals(60_000L, quietFor(clock, 5_030_000))
        // A phone clock behind the arrival never counts backwards.
        assertEquals(120_000L, turnElapsed(clock, 4_000_000))
        assertNull(quietFor(turnClockOf(header("running", quiet = null), 0)!!, 5_030_000))
    }

    @Test
    fun `the timer shows only while the agent works, and not for an older desktop`() {
        // Waiting for an approval the line says "Needs you", so no "Working" timer, though the desktop sends the time.
        assertNull(turnClockOf(header("approval"), 0))
        assertNull(turnClockOf(header("idle", elapsed = null, quiet = null), 0))
        assertNull(turnClockOf(header("running", elapsed = null), 0))
        assertNull(turnClockOf(null, 0))
    }

    @Test
    fun `an older desktop's header and tool item, without the new fields, still read`() {
        val json = RemoteFrames.json
        val old = json.decodeFromString(
            RemoteThreadHeader.serializer(),
            """{"id":"t1","workspaceId":"w1","title":"x","provider":"codex","status":"running","pendingRequests":0,"updatedAt":1,"queued":2,"canSteer":false}""",
        )
        assertNull(old.turnElapsedMs)
        assertNull(old.queuedPreview)
        assertNull(turnClockOf(old, 0))
        assertEquals(0, shownQueue(old.queuedPreview, old.queued).first.size)
        assertEquals(2L, shownQueue(old.queuedPreview, old.queued).second)
    }

    @Test
    fun `a diff shows only project-relative paths, at most 20 files and 8 KB of patch`() {
        val files = listOf("src/a.ts", "/etc/passwd", "C:/Windows/x", "\\\\host\\share\\x", "../up.ts", "a/../../b", "ok/b.ts", "nul\u0000.ts")
            .map { RemoteToolDiffFile(it, 1, 1) }
        val shown = shownDiff(RemoteToolDiff(files))
        assertEquals(listOf("src/a.ts", "ok/b.ts"), shown.files.map { it.path })
        // Dropping a path the desktop should never have sent says so.
        assertTrue(shown.truncated == true)
        assertFalse(shownDiff(RemoteToolDiff(listOf(RemoteToolDiffFile("src/a.ts", 1, 1)))).truncated == true)

        val many = shownDiff(RemoteToolDiff((1..25).map { RemoteToolDiffFile("f$it.ts", 1, 0) }, patch = "x".repeat(RemoteDiffLimits.PATCH_BYTES + 10)))
        assertEquals(RemoteDiffLimits.FILES, many.files.size)
        assertEquals(RemoteDiffLimits.PATCH_BYTES, many.patch!!.length)
        assertTrue(many.truncated == true)
        assertTrue(shownDiff(RemoteToolDiff(emptyList(), truncated = true)).truncated == true)
    }

    @Test
    fun `the patch limit is in UTF-8 bytes and never splits a character`() {
        val patch = "é".repeat(RemoteDiffLimits.PATCH_BYTES) // 2 bytes each
        val cut = shownDiff(RemoteToolDiff(emptyList(), patch = patch)).patch!!
        assertEquals(RemoteDiffLimits.PATCH_BYTES, cut.toByteArray(Charsets.UTF_8).size)
        val emoji = shownDiff(RemoteToolDiff(emptyList(), patch = "😀".repeat(RemoteDiffLimits.PATCH_BYTES))).patch!!
        assertFalse(Character.isHighSurrogate(emoji.last()))
    }

    @Test
    fun `the queue lists at most five and counts the rest`() {
        val preview = (1..7).map { RemoteQueuedPreview("q$it", "message $it") }
        val (shown, more) = shownQueue(preview, queued = 9)
        assertEquals(5, shown.size)
        assertEquals(4L, more)
        assertEquals(0L, shownQueue(preview.take(2), queued = 2).second)
    }
}
