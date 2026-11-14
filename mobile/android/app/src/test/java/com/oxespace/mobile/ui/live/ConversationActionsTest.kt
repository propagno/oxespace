package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.PhoneScale
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.Samples
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A9 (OXE program oxespace-152-mobile, phase F3, Jira OXE-102 / BRD-24 F1,
 * CA-5 and CA-6: the two adjustments MARCA added from the side-by-side of 14/11). Written by the planner; the executor
 * must not edit it.
 *
 * - CA-5: one main-action style per screen, never two "Revisar": a conversation waiting on a request shows exactly one
 *   "Revisar" (thread_review), and it opens that request. Today the now line (NowBanner, GHOST) and the gate card
 *   (GateCard, PRIMARY) each have one.
 * - CA-6: the request card is neutral with a single signal: the RiskChip it receives. No attn border, no attn strip
 *   (surfaceRaised with borderSubtle, OxeRadius.lg), so the card never shows border + badge + strip together. The sun
 *   (attn) stays on the now line, which already says "Precisa de você" (MG4).
 * - BRD-07 (OXE-69) in Conversation.kt and ThreadScreen.kt: radii only OxeRadius (today 4, 12, 14 and 24 dp literals;
 *   the composer pill becomes OxeRadius.full), nothing under 11 sp.
 * ScreensMatchHandoffTest still holds: ThreadScreen.kt keeps calling NowBanner, GateCard, StepsSummary and ProviderAvatar.
 *
 * Red at F3 @ origin/main f417a86f0: two "Revisar"; GateCard draws an attnBorder border and an attn strip; literal radii.
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

    @Test
    fun aConversationWaitingOnARequestHasOneReviewThatOpensIt() {
        fun RenderedScreen.reviews() = string("thread_review").let { review -> buttons().filter { text(it).contains(review) || label(it).contains(review) } }
        val screen = waiting { s -> s.reviews().singleOrNull()?.let(s::tap) }
        val review = screen.string("thread_review")
        val leaves = screen.leavesWithText(review)
        assertEquals("one \"$review\" on the screen (texts: ${screen.leaves.map { screen.text(it) }.filter { it.isNotBlank() }})", 1, leaves.size)
        assertEquals("one button says it", 1, screen.reviews().size)
        assertEquals("it opens the waiting request", setOf("r-1"), opened.toSet())
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
    fun theConversationFollowsThePhoneScale() {
        val offenders = PhoneScale.offenders("components/Conversation.kt") + PhoneScale.offenders("live/ThreadScreen.kt")
        assertEquals("BRD-07 in Conversation.kt and ThreadScreen.kt", emptyList<String>(), offenders)
        val small = waiting().textSizes().filter { it.second < 11f }
        assertEquals("no text under 11 sp in the conversation", emptyList<Pair<String, Float>>(), small)
    }
}
