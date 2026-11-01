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
