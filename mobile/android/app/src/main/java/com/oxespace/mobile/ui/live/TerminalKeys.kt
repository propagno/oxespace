package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.showHidden

/*
 * M11: the keys a phone keyboard doesn't have, for a pane the desktop lets the phone type into. Each sends exactly the
 * bytes a terminal expects (xterm), through the same terminal.write and presence gate as a typed line.
 */

enum class TerminalKey(val label: String, val bytes: String) {
    ESC("Esc", "\u001b"),
    TAB("Tab", "\t"),
    BACK_TAB("⇧Tab", "\u001b[Z"),
    CTRL_C("Ctrl+C", "\u0003"),
    UP("↑", "\u001b[A"),
    DOWN("↓", "\u001b[B"),
    LEFT("←", "\u001b[D"),
    RIGHT("→", "\u001b[C"),
}

/** The terminal's text sizes (sp); the middle one is the desktop's terminal size on a phone. */
enum class TerminalTextSize(val sp: Int) { SMALL(11), MEDIUM(13), LARGE(16) }

/** A stored size name back to a size; anything unknown is the default. */
fun terminalTextSize(stored: String?): TerminalTextSize = TerminalTextSize.entries.firstOrNull { it.name == stored } ?: TerminalTextSize.MEDIUM

/** What a line needs before it goes to a terminal (SECURITY #386): nothing, a look at its hidden characters, or an OK for its lines. */
sealed interface LineCheck {
    data object Clear : LineCheck

    /** Control or format characters (ESC, bidi, zero-width…) that would act unseen: shown written out instead. */
    data class Hidden(val shown: String) : LineCheck

    /** Several lines: each would run as typed, so the person says so first. */
    data class Lines(val count: Int) : LineCheck
}

/** Pasted or typed text, as it would go: hidden characters first (they can hide lines too), then line breaks. */
fun lineCheck(text: String): LineCheck {
    val flat = text.replace("\r\n", "\n").replace('\r', '\n')
    val shown = showHidden(flat)
    if (shown != flat) return LineCheck.Hidden(shown)
    val lines = flat.trimEnd('\n').split('\n').size
    return if (lines > 1) LineCheck.Lines(lines) else LineCheck.Clear
}
