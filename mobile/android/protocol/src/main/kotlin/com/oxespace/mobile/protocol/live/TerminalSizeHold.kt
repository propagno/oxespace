package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteTerminalGrid
import com.oxespace.mobile.protocol.RemoteTerminalReleaseArgs
import com.oxespace.mobile.protocol.RemoteTerminalResizeArgs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A terminal grid in character cells. */
data class TerminalGrid(val cols: Int, val rows: Int)

/**
 * The grid that fits a view of [widthPx] × [heightPx] with cells of [cellWidthPx] × [cellHeightPx]: whole cells only,
 * inside the bounds the desktop accepts. Null while the view or the font has no size yet.
 */
fun terminalGridFor(widthPx: Int, heightPx: Int, cellWidthPx: Int, cellHeightPx: Int): TerminalGrid? {
    if (widthPx <= 0 || heightPx <= 0 || cellWidthPx <= 0 || cellHeightPx <= 0) return null
    return TerminalGrid(
        cols = (widthPx / cellWidthPx).coerceIn(RemoteTerminalGrid.MIN_COLS, RemoteTerminalGrid.MAX_COLS),
        rows = (heightPx / cellHeightPx).coerceIn(RemoteTerminalGrid.MIN_ROWS, RemoteTerminalGrid.MAX_ROWS),
    )
}

/** What the desktop said about this phone's hold on a terminal's size. */
enum class SizeHold {
    /** Not held: nothing asked yet, an older desktop, or the pane cannot be sized. The phone pans over the desktop's grid. */
    NONE,
    /** The terminal draws for this phone's screen. */
    HELD,
    /** The person took the size back on the desktop; it stays theirs until this phone leaves the terminal. */
    TAKEN_BACK,
}

/**
 * 1.5.0 · While a terminal's Screen view is open, the phone holds the pane's size so a full-screen CLI draws for the
 * phone (`terminal.resize`), renews the hold, and lets go when the view closes (`terminal.release`). Only one pane is
 * held at a time. Nothing is sent to a desktop whose hello did not list [FEATURE]: there the phone pans as before.
 */
class TerminalSizeHold(
    private val scope: CoroutineScope,
    private val supported: () -> Boolean,
    private val resize: suspend (RemoteTerminalResizeArgs) -> CommandResult,
    private val release: suspend (RemoteTerminalReleaseArgs) -> CommandResult,
    private val renewMs: Long = RENEW_MS,
    private val retryMs: Long = RETRY_MS,
) {
    private val lock = Any()
    private var paneId: String? = null
    private var grid: TerminalGrid? = null
    private var job: Job? = null
    /** A resize went out for [paneId]: the desktop may hold a size, or a refusal, that a release ends. */
    private var asked = false
    private val held = MutableStateFlow(SizeHold.NONE)
    val state: StateFlow<SizeHold> = held.asStateFlow()

    /** Holds [pane] at [wanted], replacing what was held before. The same pane and grid again changes nothing. */
    fun hold(pane: String, wanted: TerminalGrid) {
        synchronized(lock) { holdLocked(pane, wanted) }
    }

    private fun holdLocked(pane: String, wanted: TerminalGrid) {
        if (paneId != null && paneId != pane) letGo()
        if (paneId == pane && grid == wanted && job?.isActive == true) return
        // After a take-back the desktop refuses this phone until it leaves; asking again with another grid is no use.
        if (paneId == pane && held.value == SizeHold.TAKEN_BACK) { grid = wanted; return }
        paneId = pane
        grid = wanted
        job?.cancel()
        val args = RemoteTerminalResizeArgs(pane, wanted.cols.toLong(), wanted.rows.toLong())
        job = scope.launch {
            while (true) {
                // Not connected, or an older desktop: look again later, send nothing.
                if (!supported()) { delay(retryMs); continue }
                synchronized(lock) { if (paneId == pane) asked = true }
                when (val answer = resize(args)) {
                    is CommandResult.Done -> { settle(pane, SizeHold.HELD); delay(renewMs) }
                    is CommandResult.Refused -> when (answer.code) {
                        RemoteErrorCode.FORBIDDEN -> { settle(pane, SizeHold.TAKEN_BACK); return@launch }
                        RemoteErrorCode.RATE_LIMITED, RemoteErrorCode.INTERNAL -> delay(answer.retryAfterMs?.coerceIn(retryMs, renewMs) ?: retryMs)
                        // Hidden from the phone, no terminal, or a desktop that does not know the command after all.
                        else -> { settle(pane, SizeHold.NONE); return@launch }
                    }
                    // The connection dropped: the desktop let the size go by itself; ask again once it is back.
                    CommandResult.Offline, CommandResult.NoAnswer -> { settle(pane, SizeHold.NONE); delay(retryMs) }
                }
            }
        }
    }

    /** Lets go of [pane]'s size; nothing happens when another pane, or none, is held. */
    fun release(pane: String) {
        synchronized(lock) { if (paneId == pane) letGo() }
    }

    private fun settle(pane: String, value: SizeHold) {
        synchronized(lock) { if (paneId == pane) held.value = value }
    }

    private fun letGo() {
        job?.cancel()
        job = null
        val pane = paneId
        val wasAsked = asked
        paneId = null
        grid = null
        asked = false
        held.value = SizeHold.NONE
        // Fire and forget: without an answer the desktop lets go by itself when the hold is not renewed.
        if (pane != null && wasAsked) scope.launch { release(RemoteTerminalReleaseArgs(pane)) }
    }

    companion object {
        /** The hello feature a desktop lists when it answers `terminal.resize` and `terminal.release`. */
        const val FEATURE = "terminal.resize"
        /** The desktop ends a hold that is not renewed for two minutes; renew well inside that. */
        const val RENEW_MS = 45_000L
        const val RETRY_MS = 5_000L
    }
}
