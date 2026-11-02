package com.oxespace.mobile.protocol

/**
 * Desktop-supplied text made safe to show outside the app's own screens (notifications): control characters and
 * Unicode format characters (bidi overrides and isolates, zero-width, tags) are dropped, so a title can't reorder or
 * hide what the person reads, and it is cut to [max] characters with an ellipsis.
 */
fun displaySafe(text: String, max: Int = 120): String {
    val visible = buildString {
        text.codePoints().forEach { if (!Character.isISOControl(it) && Character.getType(it) != Character.FORMAT.toInt()) appendCodePoint(it) }
    }.trim()
    if (visible.codePointCount(0, visible.length) <= max) return visible
    return visible.substring(0, visible.offsetByCodePoints(0, max - 1)).trimEnd() + "…"
}

/**
 * Like [displaySafe] for a block of text (a reason, a detail, warnings): line breaks and tabs stay, every other
 * control and format character goes.
 */
fun displaySafeBlock(text: String, max: Int): String {
    val visible = buildString {
        text.codePoints().forEach { if (keptWhitespace(it) || !hidden(it)) appendCodePoint(it) }
    }.trim()
    if (visible.codePointCount(0, visible.length) <= max) return visible
    return visible.substring(0, visible.offsetByCodePoints(0, max - 1)).trimEnd() + "…"
}

/**
 * For what will actually run (a command, a folder, file names): nothing is removed, because the person must see the
 * real thing. Hidden characters are written out instead (`⟨U+202E⟩`), so a bidi override can't show one ending while
 * another runs. Line breaks and tabs stay.
 */
fun showHidden(text: String): String = buildString {
    text.codePoints().forEach {
        if (!keptWhitespace(it) && hidden(it)) {
            append("⟨U+").append(Integer.toHexString(it).uppercase().padStart(4, '0')).append('⟩')
        } else {
            appendCodePoint(it)
        }
    }
}

private fun keptWhitespace(codePoint: Int) = codePoint == '\n'.code || codePoint == '\t'.code

/** Control, format (bidi, zero-width, tags) and the line and paragraph separators, which break a line that is one. */
private fun hidden(codePoint: Int) =
    Character.isISOControl(codePoint) || Character.getType(codePoint) == Character.FORMAT.toInt() || codePoint == 0x2028 || codePoint == 0x2029
