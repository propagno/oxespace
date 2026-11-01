package com.oxespace.mobile.ui.live

import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownTest {
    @Test
    fun paragraphsBoldAndInlineCode() {
        assertEquals(
            listOf(MdBlock.Paragraph(listOf(MdSpan.Plain("The check compared "), MdSpan.Bold("seconds"), MdSpan.Plain(" with "), MdSpan.Code("ms"), MdSpan.Plain(".")))),
            parseMarkdown("The check compared **seconds** with `ms`."),
        )
    }

    @Test
    fun listsAndFencedCode() {
        val blocks = parseMarkdown("Done:\n- fixed `isExpired`\n2. added a test\n\n```bash\nnpm test -- auth\n```\nAll green.")
        assertEquals(
            listOf(
                MdBlock.Paragraph(listOf(MdSpan.Plain("Done:"))),
                MdBlock.Bullet("•", listOf(MdSpan.Plain("fixed "), MdSpan.Code("isExpired"))),
                MdBlock.Bullet("2.", listOf(MdSpan.Plain("added a test"))),
                MdBlock.Code("bash", "npm test -- auth"),
                MdBlock.Paragraph(listOf(MdSpan.Plain("All green."))),
            ),
            blocks,
        )
    }

    @Test
    fun unmatchedMarkersStayPlainAndLinksShowTheirText() {
        assertEquals(listOf(MdBlock.Paragraph(listOf(MdSpan.Plain("a **b")))), parseMarkdown("a **b"))
        assertEquals(listOf(MdBlock.Paragraph(listOf(MdSpan.Plain("see `x")))), parseMarkdown("see `x"))
        assertEquals(listOf(MdBlock.Paragraph(listOf(MdSpan.Plain("open the docs")))), parseMarkdown("open [the docs](https://example.com)"))
    }

    @Test
    fun anUnclosedFenceKeepsTheRestAsCode() {
        assertEquals(listOf(MdBlock.Code(null, "rm -rf dist")), parseMarkdown("```\nrm -rf dist"))
    }
}
