package com.oxespace.mobile.protocol.live

/** A run of one style inside a [VtLine]: [start] until [end] (exclusive), color 0–15 or null for the default. */
data class VtRun(val start: Int, val end: Int, val color: Int?, val bold: Boolean)

/** One rendered line: its text and the styled runs over it. Immutable, so a view can keep it while nothing changes. */
data class VtLine(val text: String, val runs: List<VtRun>)

/**
 * A small VT screen for the phone's read-only terminal view (T97). In 1.4.2 the phone appended the stream and dropped
 * every cursor move and erase. A full-screen program (Claude Code's Ink TUI, Codex's ratatui) then piled its frames
 * one under another, and the view pinned to the bottom showed a black screen with a lone "> ".
 *
 * What it keeps:
 * - the main screen with its scrollback, and the alternate screen (?1049 with cursor save, ?1047 and ?47);
 * - cursor moves CUU CUD CUF CUB CNL CPL CHA VPA CUP HVP, and DECSC/DECRC or CSI s/u;
 * - erases EL ED ECH, and DCH ICH;
 * - CR, LF (taken as a new line, as the PTY's onlcr writes it), BS and TAB;
 * - SGR colors 0–15 and bold, as before.
 *
 * Everything else is read and dropped: OSC titles and links, other modes (?25 included), charsets, scroll regions.
 * The width is unbounded: the desktop doesn't send the PTY's columns (that's (B), 1.5), and Ink and ratatui never
 * write past them, so nothing wraps.
 *
 * Fed one chunk at a time, keeping the parser state across chunks. Only changed lines are rebuilt. Holds at most
 * [capacity] characters, dropping whole lines from the top of the main screen.
 */
class VtScreen(private val capacity: Int = 256 * 1024) {
    private class Line {
        val chars = StringBuilder()
        var styles = IntArray(8)
        var cached: VtLine? = null

        fun length() = chars.length
        fun style(at: Int) = if (at < chars.length) styles[at] else 0
        fun put(at: Int, char: Char, style: Int) {
            while (chars.length < at) { ensure(chars.length + 1); styles[chars.length] = 0; chars.append(' ') }
            if (at == chars.length) { ensure(at + 1); chars.append(char) } else chars.setCharAt(at, char)
            styles[at] = style
            cached = null
        }
        fun truncate(at: Int) { if (at < chars.length) { chars.setLength(at); cached = null } }
        fun blank(from: Int, until: Int) {
            val end = minOf(until, chars.length)
            for (i in from until end) { chars.setCharAt(i, ' '); styles[i] = 0 }
            if (from < end) cached = null
        }
        fun delete(at: Int, count: Int) {
            if (at >= chars.length) return
            val end = minOf(chars.length, at + count)
            chars.delete(at, end)
            System.arraycopy(styles, end, styles, at, styles.size - end)
            cached = null
        }
        fun insert(at: Int, count: Int) {
            if (at >= chars.length) return
            ensure(chars.length + count)
            System.arraycopy(styles, at, styles, at + count, chars.length - at)
            chars.insert(at, " ".repeat(count))
            for (i in at until at + count) styles[i] = 0
            cached = null
        }
        private fun ensure(size: Int) { if (size > styles.size) styles = styles.copyOf(maxOf(size, styles.size * 2)) }

        fun render(): VtLine = cached ?: run {
            val runs = mutableListOf<VtRun>()
            var start = 0
            for (i in 1..chars.length) {
                if (i == chars.length || styles[i] != styles[start]) {
                    val s = styles[start]
                    runs += VtRun(start, i, (s and COLOR_MASK).let { if (it == 0) null else it - 1 }, s and BOLD != 0)
                    start = i
                }
            }
            VtLine(chars.toString(), runs).also { cached = it }
        }
    }

    private class Saved(val row: Int, val col: Int, val style: Int)

    private var main = mutableListOf(Line())
    private var alt: MutableList<Line>? = null
    /** Index in [main] where the visible screen starts; lines above it are scrollback. */
    private var top = 0
    private var row = 0
    private var col = 0
    private var style = 0
    private var savedMain: Saved? = null
    private var saved: Saved? = null
    private var chars = 1 // newlines counted as one each, like the text the view shows
    /** An escape sequence cut by the end of the last chunk, waiting for the rest. */
    private val pending = StringBuilder()

    private val lines: MutableList<Line> get() = alt ?: main
    private val screenTop: Int get() = if (alt != null) 0 else top

    /** Changes whenever what the screen shows does. */
    var version: Long = 0
        private set

    fun reset() {
        main = mutableListOf(Line()); alt = null; top = 0; row = 0; col = 0; style = 0
        savedMain = null; saved = null; chars = 1; pending.setLength(0); rows = 0; version++
    }

    /** The lines to show: the alternate screen while a full-screen program has it, else the main screen with its scrollback. */
    fun lines(): List<VtLine> = lines.map { it.render() }

    /** The screen as plain text, trailing spaces trimmed, for tests and accessibility. */
    fun text(): String = lines.joinToString("\n") { it.chars.toString().trimEnd() }

    fun feed(data: String) {
        val input = if (pending.isEmpty()) data else pending.append(data).toString().also { pending.setLength(0) }
        var i = 0
        while (i < input.length) {
            val c = input[i]
            when {
                c == ESC -> {
                    val end = escapeEnd(input, i)
                    if (end < 0) { pending.append(input, i, input.length); break }
                    escape(input, i, end)
                    i = end
                    continue
                }
                c == '\r' -> col = 0
                c == '\n' -> { newLine(); col = 0 }
                c == '\b' -> if (col > 0) col--
                c == '\t' -> col = (col / 8 + 1) * 8
                c < ' ' || c == '\u007f' -> Unit
                else -> write(c)
            }
            i++
        }
        bound()
        version++
    }

    private fun write(c: Char) {
        val line = lines[row]
        val before = line.length()
        line.put(col, c, style)
        if (alt == null) chars += line.length() - before
        col++
    }

    private fun newLine() {
        row++
        ensureRow(row)
    }

    private fun ensureRow(target: Int) {
        while (lines.size <= target) { lines.add(Line()); if (alt == null) chars++ }
        // With the pane's height known, the screen is its last [rows] lines and everything above is scrollback, as in
        // a real terminal; absolute moves (CUP) then land where the desktop's emulator put them.
        if (alt == null && rows > 0) top = maxOf(top, main.size - rows)
    }

    /** The pane's height, from the desktop's snapshot (P4). 0, the default, keeps the screen top where clears put it. */
    private var rows = 0

    /** A fresh screen of [rows] lines, before a snapshot is fed (P4). The width stays unbounded until wrapping lands. */
    /** 1.5.0 F10 skeleton (A45): the grid exactly [cols] wide, wrapping and clamping as xterm does. MOB-A45 replaces the TODO. */
    @Suppress("UNUSED_PARAMETER")
    fun reset(cols: Int, rows: Int) {
        TODO("F10 A45")
    }

    fun reset(rows: Int) {
        reset()
        this.rows = rows.coerceAtLeast(0)
    }

    /** The index just past the escape sequence starting at [start], or -1 when the chunk ends inside it. */
    private fun escapeEnd(s: String, start: Int): Int {
        if (start + 1 >= s.length) return -1
        return when (s[start + 1]) {
            '[' -> {
                var j = start + 2
                while (j < s.length && s[j] !in '@'..'~') j++
                if (j < s.length) j + 1 else -1
            }
            ']', 'P', '_', '^' -> {
                // OSC and other strings: up to BEL or ST (ESC \).
                var j = start + 2
                while (j < s.length) {
                    if (s[j] == BEL) return j + 1
                    if (s[j] == ESC) return if (j + 1 < s.length) (if (s[j + 1] == '\\') j + 2 else j) else -1
                    j++
                }
                -1
            }
            '(', ')', '*', '+', '#', '%' -> if (start + 2 < s.length) start + 3 else -1
            else -> start + 2
        }
    }

    private fun escape(s: String, start: Int, end: Int) {
        when (s[start + 1]) {
            '[' -> csi(s.substring(start + 2, end - 1), s[end - 1])
            '7' -> saved = Saved(row - screenTop, col, style)
            '8' -> restore(saved)
            'M' -> if (row > screenTop) row-- // reverse index at the top would scroll; dropped
            'c' -> reset()
        }
    }

    private fun csi(params: String, final: Char) {
        val private = params.startsWith('?')
        val numbers = params.removePrefix("?").removePrefix(">").split(';').map { it.toIntOrNull() }
        fun n(index: Int = 0, default: Int = 1) = numbers.getOrNull(index)?.takeIf { it > 0 } ?: default
        if (private) {
            if (final == 'h' || final == 'l') numbers.forEach { mode(it, final == 'h') }
            return
        }
        when (final) {
            'm' -> sgr(numbers)
            'A' -> row = maxOf(screenTop, row - n())
            'B', 'e' -> { row += n(); ensureRow(row) }
            'C', 'a' -> col += n()
            'D' -> col = maxOf(0, col - n())
            'E' -> { row += n(); ensureRow(row); col = 0 }
            'F' -> { row = maxOf(screenTop, row - n()); col = 0 }
            'G', '`' -> col = n() - 1
            'd' -> { row = screenTop + n() - 1; ensureRow(row) }
            'H', 'f' -> { row = screenTop + n(0) - 1; col = n(1) - 1; ensureRow(row) }
            'K' -> eraseLine(numbers.firstOrNull() ?: 0)
            'J' -> eraseScreen(numbers.firstOrNull() ?: 0)
            'X' -> { lines[row].blank(col, col + n()) }
            'P' -> { val l = lines[row]; val before = l.length(); l.delete(col, n()); if (alt == null) chars += l.length() - before }
            '@' -> { val l = lines[row]; val before = l.length(); l.insert(col, n()); if (alt == null) chars += l.length() - before }
            's' -> saved = Saved(row - screenTop, col, style)
            'u' -> restore(saved)
        }
    }

    private fun restore(at: Saved?) {
        at ?: return
        row = screenTop + at.row; col = at.col; style = at.style
        ensureRow(row)
    }

    private fun mode(code: Int?, on: Boolean) {
        when (code) {
            1049 -> if (on) { savedMain = Saved(row - top, col, style); enterAlt() } else { leaveAlt(); restore(savedMain) }
            1047, 47 -> if (on) enterAlt() else leaveAlt()
            // ?25 (cursor), ?1 (keypad), ?2004 (bracketed paste), mouse modes: nothing to show.
        }
    }

    private fun enterAlt() {
        if (alt != null) return
        mainCursor = row to col
        alt = mutableListOf(Line())
        row = 0; col = 0
    }

    private var mainCursor: Pair<Int, Int>? = null

    private fun leaveAlt() {
        if (alt == null) return
        alt = null
        val (r, c) = mainCursor ?: (main.lastIndex to 0)
        row = minOf(r, main.lastIndex); col = c
    }

    private fun eraseLine(how: Int) {
        val line = lines[row]
        val before = line.length()
        when (how) {
            0 -> line.truncate(col)
            1 -> line.blank(0, col + 1)
            2 -> line.truncate(0)
        }
        if (alt == null) chars += line.length() - before
    }

    private fun eraseScreen(how: Int) {
        when (how) {
            0 -> {
                eraseLine(0)
                while (lines.size > row + 1) removeLast()
            }
            1 -> { for (r in screenTop until row) truncateLine(r); lines[row].blank(0, col + 1) }
            2 -> if (alt != null) {
                alt = mutableListOf(Line()); ensureRow(row)
            } else {
                // The screen goes into the scrollback, as the desktop's terminal keeps it, and a blank screen starts.
                // The cursor goes to its top: programs follow 2J with a home move anyway, and keeping the old offset
                // would leave empty rows below with no height to fill.
                top = main.size
                main.add(Line()); chars++
                row = top
            }
            3 -> if (alt == null && top > 0) {
                // Clear the scrollback (Claude Code's /clear sends 2J then 3J).
                repeat(top) { chars -= main[0].length() + 1; main.removeAt(0) }
                row -= top; top = 0
            }
        }
    }

    private fun truncateLine(r: Int) {
        val line = lines[r]
        if (alt == null) chars -= line.length()
        line.truncate(0)
    }

    private fun removeLast() {
        val line = lines.removeAt(lines.lastIndex)
        if (alt == null) chars -= line.length() + 1
    }

    private fun sgr(codes: List<Int?>) {
        if (codes.isEmpty()) { style = 0; return }
        var p = 0
        while (p < codes.size) {
            when (val code = codes[p] ?: 0) {
                0 -> style = 0
                1 -> style = style or BOLD
                22 -> style = style and BOLD.inv()
                in 30..37 -> style = (style and COLOR_MASK.inv()) or (code - 30 + 1)
                in 90..97 -> style = (style and COLOR_MASK.inv()) or (code - 90 + 8 + 1)
                39 -> style = style and COLOR_MASK.inv()
                // 256-color and true-color: skip their arguments, keep the default color.
                38 -> { p += if (codes.getOrNull(p + 1) == 5) 2 else 4; style = style and COLOR_MASK.inv() }
                48 -> p += if (codes.getOrNull(p + 1) == 5) 2 else 4
            }
            p++
        }
    }

    /** Over [capacity]: whole lines leave from the top of the main screen's scrollback, then of the screen itself. */
    private fun bound() {
        while (chars > capacity && main.size > 1) {
            val line = main.removeAt(0)
            chars -= line.length() + 1
            if (top > 0) top--
            if (alt == null) row = maxOf(0, row - 1)
            mainCursor = mainCursor?.let { (r, c) -> maxOf(0, r - 1) to c }
        }
    }

    private companion object {
        const val ESC = '\u001B'
        const val BEL = '\u0007'
        const val COLOR_MASK = 0x1F
        const val BOLD = 0x20
    }
}
