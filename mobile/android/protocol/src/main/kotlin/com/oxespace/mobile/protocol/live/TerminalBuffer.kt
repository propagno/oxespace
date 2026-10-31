package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteTerminalData
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement

/**
 * A pane's recent output from the read-only `terminal` stream, with its ANSI escapes. The desktop has already hidden
 * secrets; [redacted] counts them so the screen can say so. Keeps at most [capacity] characters, dropping whole lines
 * from the start, like the desktop's ring.
 */
class TerminalBuffer(private val capacity: Int = 256 * 1024) : StreamListener {
    private val text = StringBuilder()

    val output: String get() = synchronized(this) { text.toString() }
    var redacted: Long = 0
        private set
    /** Changes whenever the output does, so a view knows to redraw. */
    var version: Long = 0
        private set

    override fun onSnapshot(pages: List<JsonElement>) {
        synchronized(this) {
            text.setLength(0)
            redacted = 0
            pages.mapNotNull(::read).forEach { apply(it, clearFirst = false) }
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
        if (clearFirst) text.setLength(0)
        text.append(chunk.data)
        redacted += chunk.redacted ?: 0
        if (text.length > capacity) {
            val cut = text.length - capacity
            val lineEnd = text.indexOf("\n", cut)
            text.delete(0, if (lineEnd in cut until text.length) lineEnd + 1 else cut)
        }
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
