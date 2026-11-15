package com.oxespace.mobile.ui.live

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.font.FontWeight
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.Node
import com.oxespace.mobile.ui.PhoneScale
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.Samples
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A9 v3 (OXE program oxespace-152-mobile, phase F3, Jira OXE-102 / BRD-24 F1,
 * CA-5 and CA-6: the two adjustments MARCA added from the side-by-side of 14/11; CR-F3-3: the coordination's and
 * MARCA's corrections of 14/11). Written by the planner; the executor must not edit it.
 *
 * - CA-5: one main-action style per screen. The one "Revisar" BUTTON (thread_review) is the request card's PRIMARY, and
 *   it opens the waiting request. The now line under the app bar (NowBanner) is ONE tappable line, the whole line the
 *   target (Role.Button, no button of its own): the sun icon (OxeIcons.Sun) in attnFg, "Precisa de você." in bold
 *   (thread_state_needs_you, weight 600 or more) followed by the request's phrase, and at the end "Revisar" with a
 *   chevron as TEXT, not a button; a tap on the line opens the request too.
 * - CA-6: the request card is neutral with a single signal: the RiskChip it receives. No attn border, no attn strip
 *   (surfaceRaised with borderSubtle, OxeRadius.lg), so the card never shows border + badge + strip together.
 * - A9 v3 (CR-F3-6, MARCA 14/11): above EACH agent reply there is an author line: the provider's avatar at 18 dp
 *   (radius OxeRadius.sm) and the provider's name ("Claude"). The conversation's header keeps its own layout from the
 *   target (not measured here). The avatar is one node: role Image, contentDescription = the provider's name, its letter
 *   cleared from the semantics; the letter's size comes from the avatar's dp size or an OxeTokens.kt token, never from
 *   an N.sp literal in feature code (BrandScaleTest scans every N.sp outside OxeTokens.kt).
 * - BRD-07 (OXE-69) in Conversation.kt, ThreadScreen.kt and ProviderAvatar.kt: radii only OxeRadius (today 4, 12, 14 and
 *   24 dp literals and size * 0.28; the composer pill becomes OxeRadius.full), nothing under 11 sp.
 * ScreensMatchHandoffTest still holds: ThreadScreen.kt keeps calling NowBanner, GateCard, StepsSummary and ProviderAvatar.
 *
 * Red at F3 @ origin/main f417a86f0: the now line has its own GHOST "Revisar" button (two "Revisar" buttons) and no sun;
 * GateCard draws an attnBorder border and an attn strip; agent replies have no author line; literal radii.
 */
class ConversationActionsTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private val opened = mutableListOf<String>()

    private val request: RemotePendingRequest =
        RemoteFrames.json.decodeFromString(RemotePendingRequest.serializer(), F3Live.CRITICAL)

    private fun waiting(act: (RenderedScreen) -> Unit = {}): RenderedScreen = paparazzi.render(act = act) {
        val watched = F3Live.conversation(
            running = true, pending = 1,
            """{"type":"message","id":"m1","role":"user","text":"Clean the build and run the tests."}""",
            """{"type":"message","id":"m2","role":"assistant","text":"The old bundle breaks the redirect test, so I want to delete it."}""",
            """{"type":"request","id":"q-1","requestId":"r-1","kind":"approval","title":"Delete the build output","state":"pending"}""",
        )
        ThreadScreen("t-1", watched, LiveStreams().commands, Samples.presence, connected = true, pending = listOf(request), onOpenRequest = { opened += it }) {}
    }

    private fun RenderedScreen.review() = string("thread_review")

    /** Buttons whose label is exactly "Revisar": the card's main action. */
    private fun RenderedScreen.reviewButtons() = buttons().filter { label(it).trim() == review() }

    /** The now line: the one button stop that starts with "Precisa de você". */
    private fun RenderedScreen.nowLine(): Node? = string("thread_state_needs_you").let { lead -> buttons().singleOrNull { label(it).trim().startsWith(lead) } }

    @Test
    fun aConversationWaitingOnARequestHasOneReviewThatOpensIt() {
        val screen = waiting { s -> s.reviewButtons().singleOrNull()?.let(s::tap) }
        val review = screen.review()
        assertEquals(
            "one \"$review\" button on the screen, the card's; buttons: ${screen.buttons().map { screen.describe(it) }}",
            1, screen.reviewButtons().size,
        )
        assertEquals("it opens the waiting request", setOf("r-1"), opened.toSet())
    }

    @Test
    fun theNowLineIsOneTappableLineWithTheSunAndReviewAsText() {
        val screen = waiting { s -> s.nowLine()?.let(s::tap) }
        val lead = screen.string("thread_state_needs_you")
        val review = screen.review()
        val line = screen.nowLine()
        assertNotNull("the now line is one tappable stop that starts with \"$lead\"; buttons: ${screen.buttons().map { screen.describe(it) }}", line)
        assertEquals("a tap on the line opens the waiting request", setOf("r-1"), opened.toSet())
        val said = screen.label(line!!)
        assertTrue("the line says the request's phrase: \"$said\"", said.contains(screen.string("request_kind_agent")))
        assertTrue("the line ends with \"$review\" as text: \"$said\"", said.trimEnd().let { it.contains(review) && it.indexOf(review) > it.indexOf(lead) })
        val box = screen.boundsDp(line)
        assertTrue("the whole line is the target: at least 48 dp tall", screen.heightDp(line) >= 47.5f)
        val inside = screen.leaves.filter { node -> screen.boundsDp(node).let { it.top >= box.top - 1f && it.bottom <= box.bottom + 1f } }
        assertTrue("no button of its own inside the line", screen.buttons().none { it !== line && screen.boundsDp(it).let { b -> b.top >= box.top - 1f && b.bottom <= box.bottom + 1f } })
        val leadLeaf = inside.firstOrNull { screen.text(it).contains(lead) }
        assertNotNull("the line draws \"$lead\"", leadLeaf)
        assertTrue("\"$lead.\" is bold (600 or more)", bold(screen, leadLeaf!!, lead))
        assertTrue("\"$review\" is drawn at the line's end", inside.any { screen.text(it).trim().startsWith(review) && screen.boundsDp(it).left >= screen.boundsDp(leadLeaf).left })
        // rigor: source-assertion. The icon and its colour are not in the semantics; the look is the re-recorded golden.
        val code = PhoneScale.code("components/Conversation.kt")
        val start = code.indexOf("fun NowBanner(")
        assertTrue("Conversation.kt has NowBanner", start >= 0)
        val end = code.indexOf("\n}", start)
        val banner = code.substring(start, if (end < 0) code.length else end)
        assertTrue("the line draws the sun (OxeIcons.Sun)", banner.contains("OxeIcons.Sun"))
        assertFalse("the line has no button of its own (no OxeButton)", banner.contains("OxeButton("))
    }

    @Test
    fun theRequestCardIsNeutralWithOneSignal() {
        // rigor: source-assertion. A rendered card can't tell a border colour or a strip from a token name; the look is the
        // re-recorded conversation golden, which MARCA reviews.
        val code = PhoneScale.code("components/Conversation.kt")
        val start = code.indexOf("fun GateCard(")
        assertTrue("Conversation.kt has GateCard", start >= 0)
        val end = code.indexOf("\n}", start)
        val gate = code.substring(start, if (end < 0) code.length else end)
        val sun = Regex("""\.attn(Bg|Border|Fg)?\b""").findAll(gate).map { it.value }.toList()
        assertEquals("GateCard uses no attn token (no orange border, no orange strip)", emptyList<String>(), sun)
        assertTrue("its one signal is the risk chip slot", Regex("""(?<![A-Za-z0-9_.])risk\(\)""").containsMatchIn(gate))
        assertFalse("no strip: no fillMaxHeight bar beside the content", gate.contains("fillMaxHeight()"))
    }

    @Test
    fun eachAgentReplyHasAnAuthorLineWithAn18dpAvatar() {
        val replies = listOf("The old bundle breaks the redirect test.", "Deleted the bundle; the tests pass now.")
        val screen = paparazzi.render {
            val watched = F3Live.conversation(
                running = true, pending = 0,
                """{"type":"message","id":"m1","role":"user","text":"Clean the build and run the tests."}""",
                """{"type":"message","id":"m2","role":"assistant","text":"${replies[0]}"}""",
                """{"type":"tool","id":"x1","name":"Bash","state":"completed","detail":"rm -rf dist","output":"","exitCode":0}""",
                """{"type":"message","id":"m3","role":"assistant","text":"${replies[1]}"}""",
            )
            ThreadScreen("t-1", watched, LiveStreams().commands, Samples.presence, connected = true) {}
        }
        val avatars = screen.leaves.filter { screen.label(it).trim() == "Claude" && screen.role(it) == Role.Image }
        for (reply in replies) {
            val text = screen.leavesContaining(reply).firstOrNull()
            assertNotNull("the reply \"$reply\" is drawn", text)
            val top = screen.boundsDp(text!!).top
            val avatar = avatars.firstOrNull { screen.boundsDp(it).bottom <= top + 1f && screen.boundsDp(it).top >= top - 48f }
            assertNotNull(
                "an author line above \"$reply\": an 18 dp avatar (role Image, read \"Claude\"); avatars: ${avatars.map { "${screen.describe(it)} at ${screen.boundsDp(it).top}" }}",
                avatar,
            )
            assertEquals("the reply's avatar is 18 dp wide", 18f, screen.widthDp(avatar!!), 0.5f)
            assertEquals("the reply's avatar is 18 dp tall", 18f, screen.heightDp(avatar), 0.5f)
            val box = screen.boundsDp(avatar)
            assertTrue(
                "the author line names the provider next to the avatar",
                screen.leaves.any { it !== avatar && screen.text(it).trim() == "Claude" && screen.boundsDp(it).let { b -> b.left >= box.right - 1f && b.top < box.bottom && b.bottom > box.top } },
            )
        }
        assertTrue("the avatar's letter is not a text of its own (one node, read as the provider)", screen.leaves.none { screen.text(it).trim() == "C" })
    }

    @Test
    fun theAvatarIsOneNodeAndItsGlyphSizeIsNoLiteral() {
        // rigor: source-assertion. BrandScaleTest (OXE-69) scans every N.sp literal outside OxeTokens.kt: the glyph size
        // comes from the avatar's dp size or from an OxeTokens.kt token, never from a literal in ProviderAvatar.kt.
        val code = PhoneScale.code("components/ProviderAvatar.kt")
        assertTrue("the avatar's radius is OxeRadius.sm", code.contains("RoundedCornerShape(OxeRadius.sm)"))
        assertEquals("no N.sp literal in ProviderAvatar.kt", emptyList<String>(), Regex("""\b\d+(\.\d+)?\.sp\b""").findAll(code).map { it.value }.toList())
        assertTrue("one node: clearAndSetSemantics with the provider's name", code.contains("clearAndSetSemantics"))
        assertTrue("its role is an image", code.contains("Role.Image"))
    }

    @Test
    fun theConversationFollowsThePhoneScale() {
        val offenders = PhoneScale.offenders("components/Conversation.kt") + PhoneScale.offenders("live/ThreadScreen.kt") + PhoneScale.offenders("components/ProviderAvatar.kt")
        assertEquals("BRD-07 in Conversation.kt, ThreadScreen.kt and ProviderAvatar.kt", emptyList<String>(), offenders)
        val small = waiting().textSizes().filter { it.second < 11f }
        assertEquals("no text under 11 sp in the conversation", emptyList<Pair<String, Float>>(), small)
    }

    /** [part] is drawn at weight 600 or more: the leaf's own style, or a span over it. */
    private fun bold(screen: RenderedScreen, node: Node, part: String): Boolean {
        val strong = { weight: FontWeight? -> (weight ?: FontWeight.Normal) >= FontWeight(600) }
        val text = node.config.getOrNull(SemanticsProperties.Text)?.firstOrNull() ?: return false
        val at = text.text.indexOf(part)
        if (at < 0) return false
        val spanned = text.spanStyles.any { strong(it.item.fontWeight) && it.start <= at && it.end >= at + part.length }
        return spanned || (strong(screen.style(node)?.fontWeight) && text.text.trim().removeSuffix(".").trim() == part)
    }
}
