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
 * - SGR colors 0–15 and bold, as before;
 * - (1.5.2 A5) the scroll region DECSTBM, IL/DL, SU/SD, IND/NEL and RI, as xterm: LF at the bottom of the region
 *   scrolls only the region, RI at its top scrolls it down, and LF on the last row of the alternate screen (its height
 *   known) scrolls instead of growing a line, so full-screen CLIs (Codex, vim, less, htop) keep their rows.
 *
 * Everything else is read and dropped: OSC titles and links, other modes (?25 included), charsets.
 *
 * The width (1.5.0 A45): with the desktop's columns known from its snapshot ([reset] with cols), the grid is exactly
 * that wide, as xterm's: a line wraps at the edge (autowrap, the wrap pending until the next printed character), CUP,
 * CHA, CUF and TAB clamp to the last column, and a wide character (CJK, emoji) takes two columns, wrapping whole when
 * only one is left. Without a snapshot (an older desktop) the width stays unbounded, as in 1.4.3.
 *
 * Fed one chunk at a time, keeping the parser state across chunks. Only changed lines are rebuilt. Holds at most
 * [capacity] characters, dropping whole lines from the top of the main screen.
 */
class VtScreen(private val capacity: Int = 256 * 1024) {
    private class Line {
        val chars = StringBuilder()
        var styles = IntArray(8)
        var cached: VtLine? = null
        /** Holds a character whose columns differ from its UTF-16 length (CJK); its cells are then counted, not indexed. */
        var wide = false

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
    /** A surrogate high half waiting for its low half (possibly in the next chunk). */
    private var high: Char? = null

    private val lines: MutableList<Line> get() = alt ?: main
    private val screenTop: Int get() = if (alt != null) 0 else top

    /** Changes whenever what the screen shows does. */
    var version: Long = 0
        private set

    /** A blank screen; the width stays what the last snapshot set (a RIS or a truncated ring doesn't change the pane). */
    fun reset() {
        main = mutableListOf(Line()); alt = null; top = 0; row = 0; col = 0; style = 0
        savedMain = null; saved = null; chars = 1; pending.setLength(0); high = null; rows = 0
        marginTop = 0; marginBottom = -1; version++
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
                c == '\b' -> if (col > 0) col = maxOf(0, clampCol(col) - 1)
                c == '\t' -> col = clampCol((col / 8 + 1) * 8)
                c < ' ' || c == '\u007f' -> Unit
                c.isHighSurrogate() -> { high = c; i++; continue }
                c.isLowSurrogate() -> high?.let { first -> put("$first$c", widthOf(Character.toCodePoint(first, c))) }
                else -> put(c.toString(), widthOf(c.code))
            }
            high = null
            i++
        }
        bound()
        version++
    }

    /**
     * Prints one character ([text] is one code point, two chars for a surrogate pair) taking [width] columns. With a
     * width known, a character that doesn't fit what is left of the row (the cursor past the last column, or a wide one
     * at the last column) goes to the start of the next row first, as xterm's autowrap does.
     */
    private fun put(text: String, width: Int) {
        if (cols > 0) {
            val used = cellsAt(lines[row], col)
            if (used > 0 && used + width > cols) { newLine(); col = 0 }
        }
        val line = lines[row]
        val before = line.length()
        for (k in text.indices) line.put(col + k, text[k], style)
        if (width != text.length) line.wide = true
        if (alt == null) chars += line.length() - before
        col += text.length
    }

    /** The columns before index [index] of [line]: the index itself unless the line holds a wide character. */
    private fun cellsAt(line: Line, index: Int): Int {
        if (!line.wide) return index
        val end = minOf(index, line.length())
        var cells = 0
        var i = 0
        while (i < end) {
            val cp = line.chars.codePointAt(i)
            cells += widthOf(cp)
            i += Character.charCount(cp)
        }
        return cells + maxOf(0, index - line.length())
    }

    /** A cursor column kept inside the grid when the width is known. */
    private fun clampCol(value: Int): Int = if (cols > 0) minOf(value, cols - 1) else value

    private fun newLine() {
        val rel = row - screenTop
        val bottom = regionBottom()
        val regionSet = marginTop > 0 || marginBottom >= 0
        if (((alt != null && rows > 0) || regionSet) && rel == bottom) { scrollUp(marginTop, bottom, 1); return }
        // Below the region on the alternate screen's last row: the cursor stays, as xterm's does.
        if (alt != null && rows > 0 && rel >= rows - 1) return
        row++
        ensureRow(row)
    }

    /** The top margin of the scroll region (DECSTBM), screen-relative. */
    private var marginTop = 0
    /** The bottom margin of the scroll region, screen-relative; -1 for the screen's last row. */
    private var marginBottom = -1

    /** The last row the scroll region covers, screen-relative. */
    private fun regionBottom(): Int = when {
        marginBottom >= 0 -> marginBottom
        rows > 0 -> rows - 1
        else -> maxOf(0, lines.size - 1 - screenTop)
    }

    /** Rows [from]..[until] (screen-relative) move up [count]: the top ones leave, blank rows come in at the bottom. */
    private fun scrollUp(from: Int, until: Int, count: Int) {
        if (from > until) return
        ensureRow(screenTop + until)
        repeat(minOf(count, until - from + 1)) {
            val gone = lines.removeAt(screenTop + from)
            lines.add(screenTop + until, Line())
            if (alt == null) chars -= gone.length()
        }
    }

    /** Rows [from]..[until] (screen-relative) move down [count]: the bottom ones leave, blank rows come in at the top. */
    private fun scrollDown(from: Int, until: Int, count: Int) {
        if (from > until) return
        ensureRow(screenTop + until)
        repeat(minOf(count, until - from + 1)) {
            val gone = lines.removeAt(screenTop + until)
            lines.add(screenTop + from, Line())
            if (alt == null) chars -= gone.length()
        }
    }

    /**
     * DECSTBM: the region from row [first] to [last] (1-based); the cursor goes home. A region from the first row with
     * no known height, or covering the whole known height, is the default (no region).
     */
    private fun setMargins(first: Int, last: Int?) {
        val t = first - 1
        val b = (last ?: if (rows > 0) rows else 0) - 1
        val limit = if (rows > 0) rows - 1 else Int.MAX_VALUE
        val bottom = minOf(b, limit)
        if (b < 0 || (t == 0 && (rows == 0 || bottom == rows - 1))) { marginTop = 0; marginBottom = -1 }
        else if (t < bottom) { marginTop = t; marginBottom = bottom }
        else return
        row = screenTop; col = 0
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

    /** The pane's width, from the desktop's snapshot (A45). 0, the default, keeps the width unbounded as in 1.4.3. */
    private var cols = 0

    /**
     * A fresh screen of [rows] lines, exactly [cols] wide, before a snapshot is fed (P4, A45): lines wrap and the cursor
     * clamps as xterm does. 0 for either leaves it unknown (no fixed height; an unbounded width).
     */
    fun reset(cols: Int, rows: Int) {
        reset()
        this.cols = cols.coerceAtLeast(0)
        this.rows = rows.coerceAtLeast(0)
    }

    /** A fresh screen of [rows] lines with no known width (P4 before A45). */
    fun reset(rows: Int) = reset(0, rows)

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
            // RI at the region's top scrolls it down; IND and NEL move down, scrolling at the bottom.
            'M' -> if (row - screenTop == marginTop) scrollDown(marginTop, regionBottom(), 1) else if (row > screenTop) row--
            'D' -> newLine()
            'E' -> { newLine(); col = 0 }
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
            'C', 'a' -> col = clampCol(col + n())
            'D' -> col = maxOf(0, clampCol(col) - n())
            'E' -> { row += n(); ensureRow(row); col = 0 }
            'F' -> { row = maxOf(screenTop, row - n()); col = 0 }
            'G', '`' -> col = clampCol(n() - 1)
            'd' -> { row = screenTop + n() - 1; ensureRow(row) }
            'H', 'f' -> { row = screenTop + n(0) - 1; col = clampCol(n(1) - 1); ensureRow(row) }
            'K' -> eraseLine(numbers.firstOrNull() ?: 0)
            'J' -> eraseScreen(numbers.firstOrNull() ?: 0)
            'X' -> { lines[row].blank(col, col + n()) }
            'P' -> { val l = lines[row]; val before = l.length(); l.delete(col, n()); if (alt == null) chars += l.length() - before }
            '@' -> {
                val l = lines[row]; val before = l.length(); l.insert(col, n())
                // ICH pushes the row's end past the edge, where xterm drops it.
                if (cols > 0) l.truncate(cols)
                if (alt == null) chars += l.length() - before
            }
            'L' -> { val rel = row - screenTop; val b = regionBottom(); if (rel in marginTop..b) { scrollDown(rel, b, n()); col = 0 } }
            'M' -> { val rel = row - screenTop; val b = regionBottom(); if (rel in marginTop..b) { scrollUp(rel, b, n()); col = 0 } }
            'S' -> scrollUp(marginTop, regionBottom(), n())
            // CSI T with five arguments is xterm's mouse highlight, not SD.
            'T' -> if (numbers.size <= 1) scrollDown(marginTop, regionBottom(), n())
            'r' -> setMargins(n(0), numbers.getOrNull(1)?.takeIf { it > 0 })
            's' -> saved = Saved(row - screenTop, col, style)
            'u' -> restore(saved)
        }
    }

    private fun restore(at: Saved?) {
        at ?: return
        row = screenTop + at.row; col = clampCol(at.col); style = at.style
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

    /** Columns a code point takes, as xterm's wcwidth counts the East Asian wide ranges and emoji. */
    private fun widthOf(cp: Int): Int = if (
        cp in 0x1100..0x115F || cp in 0x2E80..0x303E || cp in 0x3041..0x33FF || cp in 0x3400..0x4DBF ||
        cp in 0x4E00..0x9FFF || cp in 0xA000..0xA4CF || cp in 0xAC00..0xD7A3 || cp in 0xF900..0xFAFF ||
        cp in 0xFE30..0xFE4F || cp in 0xFF00..0xFF60 || cp in 0xFFE0..0xFFE6 || cp in 0x1F300..0x1F64F ||
        cp in 0x1F900..0x1F9FF || cp in 0x20000..0x3FFFD
    ) 2 else 1

    private companion object {
        const val ESC = '\u001B'
        const val BEL = '\u0007'
        const val COLOR_MASK = 0x1F
        const val BOLD = 0x20
    }
}
