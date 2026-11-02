package com.oxespace.mobile.ui.terminal

/** A run of terminal text with its color (0–7 normal, 8–15 bright, null default) and weight. */
data class AnsiSpan(val text: String, val color: Int? = null, val bold: Boolean = false)

/**
 * Reads terminal output as text with colors, for a read-only view: SGR colors and bold are kept, every other escape
 * (cursor moves, clears, titles, hyperlinks) is dropped, and carriage returns rewrite the current line the way a
 * progress bar expects. Not a terminal emulator: full-screen programs show as their text.
 */
object Ansi {
    private const val ESC = '\u001B'
    private const val BEL = '\u0007'

    fun parse(input: String): List<AnsiSpan> {
        val spans = mutableListOf<AnsiSpan>()
        val run = StringBuilder()
        var color: Int? = null
        var bold = false

        fun flush() {
            if (run.isEmpty()) return
            val last = spans.lastOrNull()
            if (last != null && last.color == color && last.bold == bold) spans[spans.lastIndex] = last.copy(text = last.text + run)
            else spans += AnsiSpan(run.toString(), color, bold)
            run.setLength(0)
        }

        var index = 0
        while (index < input.length) {
            val char = input[index]
            when {
                char == ESC && input.getOrNull(index + 1) == '[' -> {
                    val end = (index + 2 until input.length).firstOrNull { input[it] in '@'..'~' } ?: input.length
                    if (end < input.length && input[end] == 'm') {
                        flush()
                        val codes = input.substring(index + 2, end).split(';').map { it.toIntOrNull() ?: 0 }
                        var position = 0
                        while (position < codes.size) {
                            when (val code = codes[position]) {
                                0 -> { color = null; bold = false }
                                1 -> bold = true
                                22 -> bold = false
                                in 30..37 -> color = code - 30
                                in 90..97 -> color = code - 90 + 8
                                39 -> color = null
                                // 256-color and true-color: skip their arguments, keep the default color.
                                38 -> { position += if (codes.getOrNull(position + 1) == 5) 2 else 4; color = null }
                                48 -> position += if (codes.getOrNull(position + 1) == 5) 2 else 4
                            }
                            position++
                        }
                    }
                    index = end + 1
                }
                char == ESC && input.getOrNull(index + 1) == ']' -> {
                    // OSC (titles, hyperlinks): up to BEL or ESC \.
                    var end = index + 2
                    while (end < input.length && input[end] != BEL && !(input[end] == ESC && input.getOrNull(end + 1) == '\\')) end++
                    index = if (end < input.length && input[end] == ESC) end + 2 else end + 1
                }
                char == ESC -> index += 2
                char == '\r' && input.getOrNull(index + 1) != '\n' -> {
                    // A bare carriage return starts the line over: drop what this line had so far.
                    flush()
                    trimCurrentLine(spans)
                    index++
                }
                char == '\r' -> index++
                char == '\b' || (char < ' ' && char != '\n' && char != '\t') -> index++
                else -> {
                    run.append(char)
                    index++
                }
            }
        }
        flush()
        return spans
    }

    private fun trimCurrentLine(spans: MutableList<AnsiSpan>) {
        while (spans.isNotEmpty()) {
            val last = spans.last()
            val newline = last.text.lastIndexOf('\n')
            if (newline >= 0) {
                spans[spans.lastIndex] = last.copy(text = last.text.substring(0, newline + 1))
                return
            }
            spans.removeAt(spans.lastIndex)
        }
    }
}
