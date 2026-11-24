package com.oxespace.mobile.ui.live

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.ui.components.OxeButton
import com.oxespace.mobile.ui.components.OxeButtonKind
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeCodeStyle
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * The agent's Markdown drawn on the phone (Markdown.kt parses it), at the level of OxeChat's .thread-markdown
 * (OXE-19 CA-1..4): headings in the interface family at weight 600 by BRD-07's roles (# titleMedium 16, ## 14, ### 13),
 * italics, http(s) links that Compose opens in the system browser (LocalUriHandler), tables that scroll sideways inside
 * the card, and code blocks that scroll sideways and copy the whole block. Nothing under 11 sp; radii only OxeRadius.
 */

@Composable
internal fun MarkdownText(text: String, truncated: Boolean) {
    val blocks = remember(text) { parseMarkdown(text) }
    Column(verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
        for (block in blocks) {
            when (block) {
                is MdBlock.Heading -> Text(
                    markdownSpans(block.spans),
                    style = headingStyle(block.level),
                    modifier = Modifier.semantics { heading() },
                )
                is MdBlock.Paragraph -> Text(markdownSpans(block.spans), style = MaterialTheme.typography.bodyLarge)
                is MdBlock.Bullet -> Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                    Text(block.marker, style = MaterialTheme.typography.bodyLarge, color = Oxe.colors.textSecondary)
                    Text(markdownSpans(block.spans), style = MaterialTheme.typography.bodyLarge)
                }
                is MdBlock.Code -> CodeBlock(block.text)
                is MdBlock.Table -> TableBlock(block)
            }
        }
        if (truncated) Text(stringResource(R.string.thread_truncated), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted)
    }
}

/** BRD-07's heading roles: # is titleMedium (16), ## 14, ### and deeper 13, all in the interface family at 600. */
@Composable
private fun headingStyle(level: Int): TextStyle {
    val size = when (level) {
        1 -> OxeType.textLg
        2 -> OxeType.textMd
        else -> OxeType.textSm
    }
    return MaterialTheme.typography.titleMedium.copy(fontSize = size, lineHeight = size * OxeType.leadingSnug, fontWeight = OxeType.weightSemibold)
}

@Composable
private fun markdownSpans(spans: List<MdSpan>): AnnotatedString {
    val code = SpanStyle(fontFamily = OxeCodeStyle.fontFamily, fontSize = OxeCodeStyle.fontSize, background = Oxe.colors.surfaceSunken)
    val link = TextLinkStyles(style = SpanStyle(color = Oxe.colors.textAccent, textDecoration = TextDecoration.Underline))
    return buildAnnotatedString {
        for (span in spans) {
            when (span) {
                is MdSpan.Plain -> append(span.text)
                is MdSpan.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(span.text) }
                is MdSpan.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(span.text) }
                is MdSpan.Code -> withStyle(code) { append(span.text) }
                is MdSpan.Link -> withLink(LinkAnnotation.Url(span.url, link)) { append(span.text) }
            }
        }
    }
}

/**
 * A pipe table: one column per header cell, each a column of its cells so the columns line up, the header at 600,
 * inside a bordered box as wide as the card that scrolls sideways when the table is wider.
 */
@Composable
private fun TableBlock(table: MdBlock.Table) {
    val body = MaterialTheme.typography.bodyMedium
    val head = body.copy(fontWeight = OxeType.weightSemibold)
    Box(
        Modifier.fillMaxWidth()
            .border(1.dp, Oxe.colors.borderSubtle, RoundedCornerShape(OxeRadius.md))
            .horizontalScroll(rememberScrollState()),
    ) {
        Row(Modifier.padding(vertical = OxeSpace.space1)) {
            table.header.forEachIndexed { column, title ->
                Column {
                    TableCell(title, head)
                    for (row in table.rows) TableCell(row.getOrElse(column) { emptyList() }, body)
                }
            }
        }
    }
}

@Composable
private fun TableCell(cell: List<MdSpan>, style: TextStyle) {
    Text(markdownSpans(cell), style = style, maxLines = 1, softWrap = false, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp))
}

/**
 * A code block: sunken, Plex Mono, scrolls sideways inside itself, with Copiar at the top right. `lineBackground` tints a
 * line (a diff's added and removed lines, OXE-385); Copiar always copies the plain text.
 */
@Composable
fun CodeBlock(text: String, lineBackground: (String) -> Color? = { null }) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember(text) { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(COPIED_MS); copied = false } }
    Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).background(promptFill(), RoundedCornerShape(OxeRadius.md))) {
        Text(
            tintedLines(text, lineBackground),
            style = OxeCodeStyle,
            softWrap = false,
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 10.dp, end = 76.dp, top = 14.dp, bottom = 14.dp),
        )
        OxeButton(
            text = stringResource(if (copied) R.string.thread_copied else R.string.thread_copy),
            onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("code", text))) }; copied = true },
            modifier = Modifier.align(Alignment.TopEnd),
            kind = OxeButtonKind.GHOST,
        )
    }
}

private const val COPIED_MS = 2_000L

/** `text` with each line given the background `lineBackground` picks for it, if any. */
internal fun tintedLines(text: String, lineBackground: (String) -> Color?): AnnotatedString = buildAnnotatedString {
    text.split('\n').forEachIndexed { index, line ->
        if (index > 0) append('\n')
        val background = lineBackground(line)
        if (background == null) append(line) else withStyle(SpanStyle(background = background)) { append(line) }
    }
}
