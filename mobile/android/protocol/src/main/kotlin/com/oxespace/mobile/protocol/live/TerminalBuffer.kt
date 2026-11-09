package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteTerminalData
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement

/**
 * A pane's output from the read-only `terminal` stream, kept as a screen ([VtScreen]) rather than as the raw stream.
 * Full-screen programs redraw in place, and the raw stream piled their frames up (T97). Each chunk is fed once, as it
 * arrives. The desktop has already hidden secrets, and [redacted] counts them so the screen can say so. Keeps at most
 * [capacity] characters, dropping whole lines from the start, like the desktop's ring.
 */
class TerminalBuffer(capacity: Int = 256 * 1024) : StreamListener {
    private val screen = VtScreen(capacity)

    /** The screen as plain text (tests, accessibility). */
    val output: String get() = synchronized(this) { screen.text() }

    /** The lines to draw; unchanged lines are the same objects as last time, so a list can skip them. */
    fun lines(): List<VtLine> = synchronized(this) { screen.lines() }

    private var width: Int? = null

    /**
     * The desktop's width from its latest snapshot (A45): the grid is exactly this wide and the view pans across it.
     * Null without one (an older desktop, or a ring over the frame budget): the width stays unbounded, as in 1.4.3.
     */
    val cols: Int? get() = synchronized(this) { width }

    /** 1.5.0 F10 skeleton (CR-34): the desktop hid this pane from the phone; nothing of it stays on screen. */
    val hiddenOnDesktop: Boolean get() = TODO("F10 CR34")

    var redacted: Long = 0
        private set
    /** Changes whenever the output does, so a view knows to redraw. */
    var version: Long = 0
        private set

    override fun onSnapshot(pages: List<JsonElement>) {
        synchronized(this) {
            redacted = 0
            val chunks = pages.mapNotNull(::read)
            val snapshot = chunks.firstOrNull()?.snapshot
            if (snapshot != null) {
                // P4: the desktop's own emulator, serialized: scrollback, screen, modes and cursor, already redacted.
                // Fed once at the pane's size (A45: its columns too, so a resize on the desktop follows with the next
                // snapshot). That snapshot's data pages are the same ring, so they are skipped.
                val cols = snapshot.cols.coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
                width = cols.takeIf { it > 0 }
                screen.reset(cols, snapshot.rows.coerceIn(0, Int.MAX_VALUE.toLong()).toInt())
                screen.feed(snapshot.ansi)
                chunks.forEach { redacted += it.redacted ?: 0 }
            } else {
                // A 1.4.2 desktop, or a screen over the frame budget: the ring, as before, at no known width.
                width = null
                screen.reset(0, 0)
                chunks.forEach { apply(it, clearFirst = false) }
            }
            version++
        }
    }

    override fun onEvent(data: JsonElement) {
        val chunk = read(data) ?: return
        synchronized(this) {
            // The phone was away longer than the ring is deep: what it holds no longer joins up with what follows.
            apply(chunk, clearFirst = chunk.truncated)
            version++
        }
    }

    private fun apply(chunk: RemoteTerminalData, clearFirst: Boolean) {
        if (clearFirst) screen.reset()
        screen.feed(chunk.data)
        redacted += chunk.redacted ?: 0
    }

    private fun read(element: JsonElement): RemoteTerminalData? =
        try {
            RemoteFrames.json.decodeFromJsonElement(RemoteTerminalData.serializer(), element)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
}
