package com.oxespace.mobile.ui.live

/*
 * CCR #509 · what the phone's conversation screen (M10) adds once C5 sends it: the turn timer, "no output for …", the
 * queued messages and a tool step's diff. DRAFT until the 1.4.1 cut: these types mirror #509 as BACKEND accepted it,
 * and become the generated ones when the contract lands. Every field is optional on the wire: an older desktop sends
 * none of them, and each element is hidden.
 */

/**
 * The running turn's clock as the desktop measured it when it built the snapshot or event: `turnElapsedMs` and
 * `quietMs` are elapsed times, so the two clocks never need to agree. The phone counts on from [receivedAt].
 */
data class TurnClock(val turnElapsedMs: Long, val quietMs: Long?, val receivedAt: Long)

/** How long the turn has run at [now], counting on from what the desktop sent. */
fun turnElapsed(clock: TurnClock, now: Long): Long = clock.turnElapsedMs + (now - clock.receivedAt).coerceAtLeast(0)

/** How long the agent has been silent at [now], or null when the desktop didn't say. */
fun quietFor(clock: TurnClock, now: Long): Long? = clock.quietMs?.let { it + (now - clock.receivedAt).coerceAtLeast(0) }

/** Past this, a running turn reads "No output for …" (DESIGN sets the value; one place to change it). */
const val QUIET_HINT_AFTER_MS = 3 * 60_000L

/** One message waiting to be sent while the turn runs: the person's own text, already redacted and cut by the desktop. */
data class QueuedMessage(val id: String, val text: String, val truncated: Boolean = false)

/** A file a tool step changed: project-relative, counts, or `binary` with no content. */
data class ToolDiffFile(val path: String, val additions: Int, val deletions: Int, val binary: Boolean = false)

/** A tool step's diff (#509 §3): at most 20 files and an 8 KB unified patch cut at a hunk, with `truncated`. */
data class ToolDiff(val files: List<ToolDiffFile>, val patch: String? = null, val truncated: Boolean = false)

const val DIFF_MAX_FILES = 20
const val DIFF_MAX_PATCH = 8 * 1024
const val QUEUED_MAX = 5

/**
 * What the phone shows of a diff, whatever the desktop sent: the desktop's limits applied again (a second line, not
 * the first), and only project-relative paths: an absolute path, a drive, a `..` step or a NUL is dropped, never
 * shown. A patch past the limit is cut and marked truncated.
 */
fun shownDiff(diff: ToolDiff): ToolDiff {
    val files = diff.files.filter { safeRelative(it.path) }
    val kept = files.take(DIFF_MAX_FILES)
    val patch = diff.patch?.let { if (it.length > DIFF_MAX_PATCH) it.take(DIFF_MAX_PATCH) else it }
    val cut = diff.truncated || files.size > kept.size || (diff.patch?.length ?: 0) > DIFF_MAX_PATCH
    return ToolDiff(kept, patch, cut)
}

/** The queued messages the phone lists: at most [QUEUED_MAX], with how many more are waiting. */
fun shownQueue(preview: List<QueuedMessage>, queued: Int): Pair<List<QueuedMessage>, Int> {
    val shown = preview.take(QUEUED_MAX)
    return shown to (queued - shown.size).coerceAtLeast(0)
}

private fun safeRelative(path: String): Boolean {
    if (path.isEmpty() || path.length > 400 || path.contains('\u0000')) return false
    if (path.startsWith("/") || path.startsWith("\\") || Regex("^[A-Za-z]:").containsMatchIn(path)) return false
    return path.split('/', '\\').none { it == ".." }
}
