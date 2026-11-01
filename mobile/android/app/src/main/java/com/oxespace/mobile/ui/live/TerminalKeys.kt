package com.oxespace.mobile.ui.live

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
