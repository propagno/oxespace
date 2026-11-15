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
    fun unmatchedMarkersStayPlainAndWebLinksAreLinks() {
        assertEquals(listOf(MdBlock.Paragraph(listOf(MdSpan.Plain("a **b")))), parseMarkdown("a **b"))
        assertEquals(listOf(MdBlock.Paragraph(listOf(MdSpan.Plain("see `x")))), parseMarkdown("see `x"))
        assertEquals(
            listOf(MdBlock.Paragraph(listOf(MdSpan.Plain("open "), MdSpan.Link("the docs", "https://example.com")))),
            parseMarkdown("open [the docs](https://example.com)"),
        )
    }

    @Test
    fun onlyHttpAndHttpsBecomeLinks() {
        assertEquals(
            listOf(MdSpan.Plain("a b c "), MdSpan.Link("d", "HTTP://x.y/z")),
            inline("[a](javascript:alert(1)) [b](intent://x) [c](file:///etc/hosts) [d](HTTP://x.y/z)"),
        )
    }

    @Test
    fun headingsHaveTheirLevel() {
        assertEquals(
            listOf(
                MdBlock.Heading(1, listOf(MdSpan.Plain("A"))),
                MdBlock.Heading(2, listOf(MdSpan.Plain("B"))),
                MdBlock.Heading(4, listOf(MdSpan.Plain("C"))),
                MdBlock.Paragraph(listOf(MdSpan.Plain("#tag stays"))),
            ),
            parseMarkdown("# A\n## B ##\n#### C\n#tag stays"),
        )
    }

    @Test
    fun italicWithStarsAndUnderscoresButNotInsideAWord() {
        assertEquals(
            listOf(MdSpan.Plain("is "), MdSpan.Italic("now"), MdSpan.Plain(" in "), MdSpan.Italic("ms"), MdSpan.Plain(" and snake_case_name, "), MdSpan.Bold("bold")),
            inline("is *now* in _ms_ and snake_case_name, **bold**"),
        )
        assertEquals(listOf(MdSpan.Plain("2 * 3 * 4")), inline("2 * 3 * 4"))
    }

    @Test
    fun aPipeTableIsATable() {
        assertEquals(
            listOf(
                MdBlock.Table(
                    header = listOf(listOf(MdSpan.Plain("A")), listOf(MdSpan.Plain("B"))),
                    rows = listOf(
                        listOf(listOf(MdSpan.Plain("1")), listOf(MdSpan.Code("x|y"))),
                        listOf(listOf(MdSpan.Plain("3")), listOf(MdSpan.Plain(""))),
                    ),
                ),
                MdBlock.Paragraph(listOf(MdSpan.Plain("after"))),
            ),
            parseMarkdown("| A | B |\n|---|:-:|\n| 1 | `x\\|y` |\n| 3 |\nafter"),
        )
    }

    @Test
    fun anUnclosedFenceKeepsTheRestAsCode() {
        assertEquals(listOf(MdBlock.Code(null, "rm -rf dist")), parseMarkdown("```\nrm -rf dist"))
    }
}
