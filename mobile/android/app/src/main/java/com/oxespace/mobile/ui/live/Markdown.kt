package com.oxespace.mobile.ui.live

/*
 * The agent's Markdown, as much as a phone needs (spec §2, OXE-19): paragraphs, `#` to `###` headings (deeper ones read
 * as `###`), **bold**, *italic* and _italic_ (an underscore inside a word stays as it is), `inline code`, links, bullet
 * and numbered lists, GFM pipe tables and fenced code blocks. Only http and https links become links; any other scheme
 * (javascript:, intent:, file:) shows its text only. Anything else stays plain text: nothing is interpreted as HTML,
 * and the text has already been through displaySafeBlock.
 */

sealed interface MdBlock {
    data class Paragraph(val spans: List<MdSpan>) : MdBlock
    data class Heading(val level: Int, val spans: List<MdSpan>) : MdBlock
    data class Bullet(val marker: String, val spans: List<MdSpan>) : MdBlock
    data class Code(val language: String?, val text: String) : MdBlock

    /** A pipe table: the header's cells, then each row padded (or cut) to the header's width. */
    data class Table(val header: List<List<MdSpan>>, val rows: List<List<List<MdSpan>>>) : MdBlock
}

sealed interface MdSpan {
    val text: String
    data class Plain(override val text: String) : MdSpan
    data class Bold(override val text: String) : MdSpan
    data class Italic(override val text: String) : MdSpan
    data class Code(override val text: String) : MdSpan
    data class Link(override val text: String, val url: String) : MdSpan
}

private val FENCE = Regex("""^\s*```\s*([A-Za-z0-9_+.-]*)\s*$""")
private val HEADING = Regex("""^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$""")
private val BULLET = Regex("""^\s*([-*+])\s+(.*)$""")
private val NUMBERED = Regex("""^\s*(\d{1,3})[.)]\s+(.*)$""")
private val TABLE_RULE = Regex("""^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$""")
private val CELL_BORDER = Regex("""(?<!\\)\|""")

/** `[text](url)`, the url allowed one level of parentheses (`javascript:alert(1)` is matched whole, then refused). */
private val LINK = Regex("""\[([^\]]+)]\(((?:[^()\s]|\([^()\s]*\))*)\)""")
private val WEB = Regex("""^https?://\S+$""", RegexOption.IGNORE_CASE)
private val ITALIC_STAR = Regex("""(?<![\w*])\*(?![\s*])([^*\n]*?[^\s*])\*(?![\w*])""")
private val ITALIC_UNDERSCORE = Regex("""(?<!\w)_(?![\s_])([^_\n]*?[^\s_])_(?!\w)""")

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
        if ('|' in line && i + 1 < lines.size && TABLE_RULE.matches(lines[i + 1])) {
            flushParagraph()
            val header = cells(line)
            val rows = mutableListOf<List<List<MdSpan>>>()
            i += 2
            while (i < lines.size && lines[i].isNotBlank() && '|' in lines[i]) {
                val row = cells(lines[i])
                rows += List(header.size) { inline(row.getOrElse(it) { "" }) }
                i++
            }
            blocks += MdBlock.Table(header.map { inline(it) }, rows)
            continue
        }
        val heading = HEADING.matchEntire(line)
        val bullet = BULLET.matchEntire(line)
        val numbered = NUMBERED.matchEntire(line)
        when {
            heading != null -> { flushParagraph(); blocks += MdBlock.Heading(heading.groupValues[1].length, inline(heading.groupValues[2])) }
            bullet != null -> { flushParagraph(); blocks += MdBlock.Bullet("•", inline(bullet.groupValues[2])) }
            numbered != null -> { flushParagraph(); blocks += MdBlock.Bullet("${numbered.groupValues[1]}.", inline(numbered.groupValues[2])) }
            line.isBlank() -> flushParagraph()
            else -> paragraph += line
        }
        i++
    }
    flushParagraph()
    return blocks
}

/** A table row's cells, without the outer pipes; `\|` is a pipe inside a cell. */
private fun cells(line: String): List<String> {
    var row = line.trim()
    if (row.startsWith("|")) row = row.substring(1)
    if (row.endsWith("|") && !row.endsWith("\\|")) row = row.dropLast(1)
    return row.split(CELL_BORDER).map { it.trim().replace("\\|", "|") }
}

/** `code` first (nothing inside it is formatted), then links, **bold** and *italic*. */
fun inline(text: String): List<MdSpan> {
    val spans = mutableListOf<MdSpan>()
    val parts = text.split('`')
    parts.forEachIndexed { index, part ->
        if (part.isEmpty()) return@forEachIndexed
        // An odd segment sits between backticks; an unmatched last backtick leaves its text plain.
        if (index % 2 == 1 && index < parts.lastIndex) spans += MdSpan.Code(part) else spans += links(if (index % 2 == 1) "`$part" else part)
    }
    // Adjacent plain pieces (left by an unmatched marker or a refused link) read as one.
    val merged = mutableListOf<MdSpan>()
    for (span in spans) {
        val last = merged.lastOrNull()
        if (span is MdSpan.Plain && last is MdSpan.Plain) merged[merged.lastIndex] = MdSpan.Plain(last.text + span.text) else merged += span
    }
    return merged.ifEmpty { listOf(MdSpan.Plain("")) }
}

/** Links: http and https become a Link; any other scheme shows its text only. */
private fun links(text: String): List<MdSpan> {
    val out = mutableListOf<MdSpan>()
    var at = 0
    for (match in LINK.findAll(text)) {
        if (match.range.first > at) out += emphasis(text.substring(at, match.range.first))
        val label = match.groupValues[1]
        val url = match.groupValues[2]
        out += if (WEB.matches(url)) MdSpan.Link(label, url) else MdSpan.Plain(label)
        at = match.range.last + 1
    }
    if (at < text.length) out += emphasis(text.substring(at))
    return out
}

private fun emphasis(text: String): List<MdSpan> = bold(text).flatMap { if (it is MdSpan.Plain) italic(it.text) else listOf(it) }

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

/** `*x*` and `_x_`; an underscore inside a word (snake_case_name) is not a marker. */
private fun italic(text: String): List<MdSpan> {
    val out = mutableListOf<MdSpan>()
    var at = 0
    while (at < text.length) {
        val match = listOfNotNull(ITALIC_STAR.find(text, at), ITALIC_UNDERSCORE.find(text, at)).minByOrNull { it.range.first } ?: break
        if (match.range.first > at) out += MdSpan.Plain(text.substring(at, match.range.first))
        out += MdSpan.Italic(match.groupValues[1])
        at = match.range.last + 1
    }
    if (at < text.length) out += MdSpan.Plain(text.substring(at))
    return out
}
