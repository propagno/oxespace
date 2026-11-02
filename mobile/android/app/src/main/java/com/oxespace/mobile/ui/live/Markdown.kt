package com.oxespace.mobile.ui.live

/*
 * The agent's Markdown, as much as a phone needs (spec §2): paragraphs, **bold**, `inline code`, bullet and numbered
 * lists, and fenced code blocks. Links show as their text. Anything else stays plain text: nothing is interpreted as
 * HTML, and the text has already been through displaySafeBlock.
 */

sealed interface MdBlock {
    data class Paragraph(val spans: List<MdSpan>) : MdBlock
    data class Bullet(val marker: String, val spans: List<MdSpan>) : MdBlock
    data class Code(val language: String?, val text: String) : MdBlock
}

sealed interface MdSpan {
    val text: String
    data class Plain(override val text: String) : MdSpan
    data class Bold(override val text: String) : MdSpan
    data class Code(override val text: String) : MdSpan
}

private val FENCE = Regex("^\\s*```\\s*([A-Za-z0-9_+.-]*)\\s*$")
private val BULLET = Regex("^\\s*([-*+])\\s+(.*)$")
private val NUMBERED = Regex("^\\s*(\\d{1,3})[.)]\\s+(.*)$")
private val LINK = Regex("\\[([^\\]]+)]\\([^)]*\\)")

fun parseMarkdown(text: String): List<MdBlock> {
    val blocks = mutableListOf<MdBlock>()
    val paragraph = mutableListOf<String>()
    fun flushParagraph() {
        if (paragraph.isNotEmpty()) blocks += MdBlock.Paragraph(inline(paragraph.joinToString(" ") { it.trim() }))
        paragraph.clear()
    }
    val lines = text.replace("\r\n", "\n").split('\n')
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val fence = FENCE.matchEntire(line)
        if (fence != null) {
            flushParagraph()
            val code = mutableListOf<String>()
            i++
            while (i < lines.size && FENCE.matchEntire(lines[i]) == null) code += lines[i++]
            blocks += MdBlock.Code(fence.groupValues[1].ifEmpty { null }, code.joinToString("\n"))
            i++ // the closing fence (or the end, for an unclosed one)
            continue
        }
        val bullet = BULLET.matchEntire(line)
        val numbered = NUMBERED.matchEntire(line)
        when {
            bullet != null -> { flushParagraph(); blocks += MdBlock.Bullet("•", inline(bullet.groupValues[2])) }
            numbered != null -> { flushParagraph(); blocks += MdBlock.Bullet("${numbered.groupValues[1]}.", inline(numbered.groupValues[2])) }
            line.isBlank() -> flushParagraph()
            else -> paragraph += line.trimStart('#', ' ').ifEmpty { line }
        }
        i++
    }
    flushParagraph()
    return blocks
}

/** `code` first (nothing inside it is bold), then **bold**; links become their text. */
fun inline(text: String): List<MdSpan> {
    val spans = mutableListOf<MdSpan>()
    val parts = LINK.replace(text) { it.groupValues[1] }.split('`')
    parts.forEachIndexed { index, part ->
        if (part.isEmpty()) return@forEachIndexed
        // An odd segment sits between backticks; an unmatched last backtick leaves its text plain.
        if (index % 2 == 1 && index < parts.lastIndex) spans += MdSpan.Code(part) else spans += bold(if (index % 2 == 1) "`$part" else part)
    }
    // Adjacent plain pieces (left by an unmatched marker) read as one.
    val merged = mutableListOf<MdSpan>()
    for (span in spans) {
        val last = merged.lastOrNull()
        if (span is MdSpan.Plain && last is MdSpan.Plain) merged[merged.lastIndex] = MdSpan.Plain(last.text + span.text) else merged += span
    }
    return merged.ifEmpty { listOf(MdSpan.Plain("")) }
}

private fun bold(text: String): List<MdSpan> {
    val parts = text.split("**")
    return parts.mapIndexedNotNull { index, part ->
        when {
            part.isEmpty() -> null
            index % 2 == 1 && index < parts.lastIndex -> MdSpan.Bold(part)
            index % 2 == 1 -> MdSpan.Plain("**$part")
            else -> MdSpan.Plain(part)
        }
    }
}
