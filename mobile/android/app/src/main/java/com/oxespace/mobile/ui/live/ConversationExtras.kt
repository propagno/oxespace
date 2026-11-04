package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.RemoteDiffLimits
import com.oxespace.mobile.protocol.RemoteQueuePreview
import com.oxespace.mobile.protocol.RemoteQueuedPreview
import com.oxespace.mobile.protocol.RemoteThreadHeader
import com.oxespace.mobile.protocol.RemoteToolDiff

/*
 * CCR #509: what the phone's conversation screen (M10) adds from C5. It shows the turn timer, "no output for …", the
 * queued messages and a tool step's diff. Every field is optional on the wire: an older desktop sends none of them,
 * and each element is hidden.
 */

/**
 * The running turn's clock as the desktop measured it when it built the snapshot or event. `turnElapsedMs` and
 * `quietMs` are elapsed times, so the two clocks never need to agree. The phone counts on from [receivedAt].
 */
data class TurnClock(val turnElapsedMs: Long, val quietMs: Long?, val receivedAt: Long)

/**
 * The clock of [header] received at [receivedAt], while the agent works. It is null when the desktop sent no elapsed
 * time (an older desktop) and when the turn isn't running.
 * - The desktop also sends the elapsed time while a turn waits for an approval. The phone's line then says "Needs you",
 *   not "Working".
 * - quietMs is sent only while running: waiting for the person isn't the agent going quiet.
 */
fun turnClockOf(header: RemoteThreadHeader?, receivedAt: Long): TurnClock? {
    if (header?.status != "running") return null
    val elapsed = header.turnElapsedMs ?: return null
    return TurnClock(elapsed.coerceAtLeast(0), header.quietMs?.coerceAtLeast(0), receivedAt)
}

/** How long the turn has run at [now], counting on from what the desktop sent. */
fun turnElapsed(clock: TurnClock, now: Long): Long = clock.turnElapsedMs + (now - clock.receivedAt).coerceAtLeast(0)

/** How long the agent has been silent at [now], or null when the desktop didn't say. */
fun quietFor(clock: TurnClock, now: Long): Long? = clock.quietMs?.let { it + (now - clock.receivedAt).coerceAtLeast(0) }

/** Past this, a running turn reads "No output for …". DESIGN sets the value; this is the one place to change it. */
const val QUIET_HINT_AFTER_MS = 3 * 60_000L

/**
 * What the phone shows of a diff, whatever the desktop sent. It applies the desktop's limits again, as a second line
 * of defence, not the first.
 * - Paths: only project-relative ones are shown. An absolute path, a drive, a `..` step or a NUL is dropped, never
 *   shown.
 * - Patch: one past [RemoteDiffLimits.PATCH_BYTES] UTF-8 bytes is cut and marked truncated.
 */
fun shownDiff(diff: RemoteToolDiff): RemoteToolDiff {
    val files = diff.files.filter { safeRelative(it.path) }
    val kept = files.take(RemoteDiffLimits.FILES)
    val patch = diff.patch?.let { cutToBytes(it, RemoteDiffLimits.PATCH_BYTES) }
    val cut = diff.truncated == true || files.size < diff.files.size || files.size > kept.size || patch != diff.patch
    return RemoteToolDiff(kept, patch, cut)
}

/** The queued messages the phone lists: at most [RemoteQueuePreview.ITEMS], with how many more are waiting. */
fun shownQueue(preview: List<RemoteQueuedPreview>?, queued: Long): Pair<List<RemoteQueuedPreview>, Long> {
    val shown = preview.orEmpty().take(RemoteQueuePreview.ITEMS)
    return shown to (queued - shown.size).coerceAtLeast(0)
}

private fun cutToBytes(text: String, max: Int): String {
    if (text.toByteArray(Charsets.UTF_8).size <= max) return text
    var bytes = 0
    var end = 0
    while (end < text.length) {
        val next = if (Character.isHighSurrogate(text[end]) && end + 1 < text.length) end + 2 else end + 1
        val size = text.substring(end, next).toByteArray(Charsets.UTF_8).size
        if (bytes + size > max) break
        bytes += size
        end = next
    }
    return text.substring(0, end)
}

private fun safeRelative(path: String): Boolean {
    if (path.isEmpty() || path.length > 400 || path.contains('\u0000')) return false
    if (path.startsWith("/") || path.startsWith("\\") || Regex("^[A-Za-z]:").containsMatchIn(path)) return false
    return path.split('/', '\\').none { it == ".." }
}
