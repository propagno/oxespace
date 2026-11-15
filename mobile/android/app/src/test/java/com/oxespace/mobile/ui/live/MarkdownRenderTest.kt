package com.oxespace.mobile.ui.live

import com.oxespace.mobile.ui.Node
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.PhoneScale
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.Samples
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import com.oxespace.mobile.ui.theme.OxeFonts
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A11 v2 (OXE program oxespace-152-mobile, phase F3, Jira OXE-19 CA-1 to CA-4;
 * CR-F3-4: the coordination's and MARCA's corrections of 14/11). Written by the planner; the executor must not edit it.
 *
 * The agent's Markdown in a phone conversation at the level of OxeChat, drawn by the real ThreadScreen:
 * - CA-1: `#`, `##`, `###` are headings of their own (heading semantics), in the interface family (OxeFonts.ui, as
 *   OxeChat's .thread-markdown headings) at weight 600, by BRD-07's roles: # 16 sp (titleMedium), ## 14 sp, ### 13 sp
 *   (not 20 / 16 / 14); `*x*` and `_x_` are italic; an underscore inside a word (snake_case) stays as it is;
 * - CA-2: `[text](https://…)` is a link (LinkAnnotation.Url with that url, which Compose opens in the system browser
 *   through LocalUriHandler); only http and https become links, anything else (javascript:, intent:, file:) stays text;
 * - CA-3: a GFM pipe table (header row, `---` separator, rows) is a table: one text per cell, the rows below each other,
 *   the columns aligned, inside a container that scrolls sideways and is never wider than the screen; no `|` is shown;
 * - CA-4 (already on main, kept): a code block scrolls sideways and has "Copiar", which copies the whole block.
 * Syntax highlighting is out (OXE-19 RT-1). BRD-07 (OXE-69): nothing under 11 sp, radii only OxeRadius.
 * Contract: parseMarkdown/inline in Markdown.kt gain the new blocks and spans; the drawing moves out of ThreadScreen.kt
 * (876 lines) into the new ui/live/MarkdownView.kt, so ThreadScreen.kt stays far below 1000 lines.
 *
 * Red at F3 @ origin/main f417a86f0: headings, the table's rows and the paragraph are one paragraph with the `#`, `|`
 * and `*` written out, and links show their text only.
 */
class MarkdownRenderTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private val markdown = """
        # Login fix
        ## What changed
        ### Details
        The check is *now* in _milliseconds_ and snake_case_name stays. See [the docs](https://example.com/auth) or [this](javascript:alert(1)).

        | File | Change |
        |---|---|
        | session.ts | expiry in ms |
        | session.test.ts | new test |

        ```bash
        npm test -- auth --reporter=verbose --coverage --runInBand --detectOpenHandles --silent=false
        ```
    """.trimIndent()

    private fun answer(): RenderedScreen = paparazzi.render {
        val watched = F3Live.conversation(
            running = false, pending = 0,
            """{"type":"message","id":"u1","role":"user","text":"Fix the login redirect."}""",
            """{"type":"message","id":"a1","role":"assistant","text":${JsonPrimitive(markdown)}}""",
            """{"type":"completed","id":"c1","status":"completed"}""",
        )
        ThreadScreen("t-1", watched, LiveStreams().commands, Samples.presence, connected = true) {}
    }

    private fun annotated(node: Node): AnnotatedString? = node.config.getOrNull(SemanticsProperties.Text)?.firstOrNull()

    private fun RenderedScreen.only(text: String): Node {
        val found = leavesWithText(text)
        assertEquals("one text \"$text\"; texts: ${leaves.map { this.text(it) }.filter { it.isNotBlank() }}", 1, found.size)
        return found.single()
    }

    @Test
    fun headingsAreHeadingsInTheirHierarchy() {
        val screen = answer()
        for ((text, size) in listOf("Login fix" to 16f, "What changed" to 14f, "Details" to 13f)) {
            val node = screen.only(text)
            assertTrue("\"$text\" is a heading", screen.isHeading(node))
            val style = screen.style(node)!!
            assertEquals("\"$text\" is $size sp", size, style.fontSize.value, 0.01f)
            assertEquals("\"$text\" is weight 600", FontWeight(600), style.fontWeight)
            assertEquals("\"$text\" is in the interface family", OxeFonts.ui, style.fontFamily)
        }
        assertTrue("no # is shown", screen.leaves.none { screen.text(it).trimStart().startsWith("#") })
    }

    @Test
    fun italicIsItalicAndAWordWithUnderscoresStaysAsItIs() {
        val screen = answer()
        val paragraph = screen.leavesContaining("milliseconds").singleOrNull()
        assertNotNull("the paragraph", paragraph)
        val text = annotated(paragraph!!)!!
        assertFalse("no * or _ around the italic words: \"${text.text}\"", text.text.contains("*now*") || text.text.contains("_milliseconds_"))
        for (word in listOf("now", "milliseconds")) {
            val start = text.text.indexOf(word)
            assertTrue("\"$word\" is italic", text.spanStyles.any { it.item.fontStyle == FontStyle.Italic && it.start <= start && it.end >= start + word.length })
        }
        assertTrue("snake_case_name stays", text.text.contains("snake_case_name"))
    }

    @Test
    fun anHttpLinkIsTappableAndOpensInTheBrowser() {
        val screen = answer()
        val text = annotated(screen.leavesContaining("the docs").single())!!
        val links = text.getLinkAnnotations(0, text.length)
        val docs = links.singleOrNull { text.text.substring(it.start, it.end) == "the docs" }
        assertNotNull("\"the docs\" is a link; links: ${links.map { text.text.substring(it.start, it.end) }}", docs)
        assertEquals("https://example.com/auth", (docs!!.item as LinkAnnotation.Url).url)
        assertTrue("a javascript: link stays text", links.none { text.text.substring(it.start, it.end) == "this" })
        assertFalse("the url is not written out", text.text.contains("](") || text.text.contains("javascript:"))
    }

    @Test
    fun aTableIsATableThatScrollsSideways() {
        val screen = answer()
        val file = screen.only("File")
        val change = screen.only("Change")
        val first = screen.only("session.ts")
        val second = screen.only("session.test.ts")
        screen.only("expiry in ms")
        screen.only("new test")
        val f = screen.boundsDp(file)
        assertTrue("Change is on File's row, to its right", screen.boundsDp(change).left > f.right - 1f && kotlin.math.abs(screen.boundsDp(change).top - f.top) <= 1f)
        assertTrue("session.ts is below File, in its column", screen.boundsDp(first).top >= f.bottom - 1f && kotlin.math.abs(screen.boundsDp(first).left - f.left) <= 1f)
        assertTrue("session.test.ts is below session.ts, in the same column", screen.boundsDp(second).top >= screen.boundsDp(first).bottom - 1f && kotlin.math.abs(screen.boundsDp(second).left - f.left) <= 1f)
        val scroller = screen.leaves.firstOrNull { screen.scrollsSideways(it) && screen.boundsDp(it).contains(f.center) }
        assertNotNull("the table sits in a container that scrolls sideways", scroller)
        val width = screen.leaves.first { it.isRoot }.let { screen.widthDp(it) }
        assertTrue("the table is never wider than the screen", screen.boundsDp(scroller!!).right <= width + 0.5f)
        assertTrue("no | is shown", screen.leaves.none { screen.text(it).contains("|") })
        val header = screen.style(file)!!.fontWeight
        assertTrue("the header row is at least 600", (header ?: FontWeight.Normal) >= FontWeight(600))
    }

    @Test
    fun aCodeBlockScrollsSidewaysAndCopiesTheWholeBlock() {
        val screen = answer()
        val code = screen.leaves.single { screen.text(it).startsWith("npm test -- auth --reporter=verbose") }
        val box = screen.boundsDp(code)
        assertTrue("the block scrolls sideways", screen.leaves.any { screen.scrollsSideways(it) && screen.boundsDp(it).contains(box.topLeft + androidx.compose.ui.geometry.Offset(1f, 1f)) })
        assertTrue("\"${screen.string("thread_copy")}\" is on the block", screen.buttons().any { screen.label(it).trim() == screen.string("thread_copy") })
    }

    @Test
    fun theMarkdownFollowsThePhoneScale() {
        assertEquals("BRD-07 in MarkdownView.kt", emptyList<String>(), PhoneScale.offenders("live/MarkdownView.kt"))
        val small = answer().textSizes().filter { it.second < 11f }
        assertEquals("no text under 11 sp", emptyList<Pair<String, Float>>(), small)
    }
}
