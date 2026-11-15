package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import com.oxespace.mobile.approval.AnswerBlock
import com.oxespace.mobile.approval.AnswerOutcome
import com.oxespace.mobile.approval.CRITICAL_ALLOW_HOLD_MS
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.live.CommandResult
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.Node
import com.oxespace.mobile.ui.PhoneScale
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import com.oxespace.mobile.ui.stringId
import com.oxespace.mobile.ui.theme.OxeFonts
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A7 v4 (OXE program oxespace-152-mobile, phase F3, Jira OXE-134 inside BRD-24 /
 * OXE-102; CR-F3-1, CR-F3-5 and CR-F3-7: the coordination's and MARCA's corrections of 14/11). Written by the planner; the executor must not
 * edit it.
 *
 * The "Pedidos" tab (the first tab) is the queue; its own header says "Precisa de você" (needs_you_title, a heading).
 * Each request is a card whose ONE signal is its header strip: attnBg with the sun icon (OxeIcons.Sun) in attnFg, the
 * kind in caps (needs_you_kind_command "Aprovar comando" for a command, the needs_you_kind_questions plural "N perguntas"
 * for questions) and the time on the right (labelSmall 11 sp, mono, tabular figures "tnum"). The body and its 1 dp
 * border are neutral (borderDefault): no attn border, no side strip, and no risk chip on the queue card. At critical risk
 * the header turns danger: an alert icon and always "CRÍTICO · APROVAR COMANDO" (request_risk_critical and
 * needs_you_kind_command, the app's own catalog) on intentDangerBg / intentDangerFg, with only "Revisar" on the card
 * (A7 v4, CR-F3-7, coordination 14/11, approval safety): text the agent wrote (the request's title) never labels a
 * critical request, so a hostile title ("LIMPAR CACHE") never shows in that header.
 * Buttons by kind, each at least 48 x 48 dp:
 * - CA-1, a permission (kind approval, answerable, not critical): "Negar" (request_decision_decline, SECONDARY) and
 *   "Permitir uma vez" (request_decision_accept, PRIMARY). They answer through the existing protocol and the same
 *   RequestResponder as the Request screen, keeping the existing fingerprint / screen-lock confirmation (no new prompt,
 *   none removed); the row then says "Permitido" or "Negado" (needsYouAnswerLine); offline or after a desktop error the
 *   buttons are off and the row says why (CA-3);
 * - CA-4, a question (open or multiple choice): "Responder" (needs_you_reply) alone, which opens the conversation;
 * - CA-2, critical: "Revisar" (thread_review) alone, which opens the Request screen. The queue card never holds and never
 *   allows a critical request. On the REQUEST SCREEN, "Permitir uma vez" on a critical request is off for the desktop's
 *   2 s (CRITICAL_ALLOW_HOLD_MS), then needs a 1.2 s hold (CRITICAL_ALLOW_PRESS_MS = 1200, the desktop's HoldToApprove),
 *   with progress in accent and cancel on release: a node with Role.Button, its stateDescription the hold hint
 *   (request_hold_to_allow), and no click action (a tap never allows). There the risk chip (Crítico, alert icon) sits
 *   above the title.
 * - CA-5: TalkBack reads "<agente> pede para <ação>", then "Negar", then "Permitir uma vez", each button its own stop.
 * Contract (new symbols read by name so this file compiles on the base):
 * - ui/live/NeedsYou.kt (class NeedsYouKt): `fun needsYouAnswerLine(decision: String, outcome: AnswerOutcome): Int`;
 * - ui/components/CriticalDelayAllow.kt (class CriticalDelayAllowKt): `const val CRITICAL_ALLOW_PRESS_MS = 1_200L` and
 *   `fun criticalAllowPressProgress(pressedMs: Long): Float` (0 at 0 or less, pressedMs / 1200 between, 1 from 1200 on);
 * - strings (values and values-pt-rBR): needs_you_title ("Needs you" / "Precisa de você"), needs_you_reply ("Reply" /
 *   "Responder"), needs_you_kind_command ("Approve command" / "Aprovar comando"), plurals needs_you_kind_questions,
 *   needs_you_allowed ("Allowed" / "Permitido"), needs_you_denied ("Denied" / "Negado"), needs_you_offline,
 *   request_hold_to_allow.
 * Brand (BRD-24 F1, BRD-07/OXE-69): OxeButton anatomy (48 dp, OxeRadius.lg), colours by token in both themes, no text
 * under 11 sp, radii only OxeRadius. Goldens (CA-6) are re-recorded by ci/record-phone-goldens.
 *
 * Red at F3 @ origin/main f417a86f0: the queue row has no button and no header strip (the whole row opens the Request
 * screen, with a risk line); the Request screen's critical Allow is a timer button that a tap answers, below the title.
 */
class NeedsYouRowTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private val opened = mutableListOf<String>()

    private fun queue(vararg requests: String, banner: String? = null, act: (RenderedScreen) -> Unit = {}): RenderedScreen = paparazzi.render(act = act) {
        LiveHome(
            desktopName = "Studio",
            banner = banner,
            live = F3Live.live(*requests),
            onOpenThread = { opened += "thread:$it" },
            onOpenRequest = { opened += "request:${it.requestId}" },
            onOpenTerminal = {},
            onEnterAddress = {},
            onUnpair = {},
            initialTab = LiveTab.REQUESTS,
        )
    }

    private fun requestScreen(json: String): RenderedScreen = paparazzi.render {
        RequestScreen(RemoteFrames.json.decodeFromString(RemotePendingRequest.serializer(), json), LiveStreams().commands) {}
    }

    private fun RenderedScreen.button(label: String) = buttons().filter { label(it).trim() == label }

    private fun RenderedScreen.deny() = button(string("request_decision_decline"))

    private fun RenderedScreen.allow() = button(string("request_decision_accept"))

    private fun RenderedScreen.allButtons() = buttons().map { describe(it) }

    private fun RenderedScreen.plural(name: String, count: Int): String {
        val id = try {
            Class.forName("com.oxespace.mobile.R\$plurals").getField(name).getInt(null)
        } catch (_: NoSuchFieldException) {
            throw AssertionError("the plurals resource R.plurals.$name does not exist (values/strings.xml and values-pt-rBR/strings.xml)")
        }
        return context.resources.getQuantityString(id, count, count)
    }

    private fun RenderedScreen.atLeast48(node: Node) {
        assertTrue("${describe(node)} is at least 48 dp wide", widthDp(node) >= 47.5f)
        assertTrue("${describe(node)} is at least 48 dp tall", heightDp(node) >= 47.5f)
    }

    private val time = Regex("""^(\d+ min|agora|\d{1,2}:\d{2})$""")

    // ---- CA-1 ----------------------------------------------------------------------------------------------------

    @Test
    fun aPermissionCardShowsDenyAndAllowOnceOfAtLeast48dp() {
        val screen = queue(F3Live.APPROVAL)
        val deny = screen.deny().singleOrNull()
        val allow = screen.allow().singleOrNull()
        assertNotNull("the card has \"${screen.string("request_decision_decline")}\"; buttons: ${screen.allButtons()}", deny)
        assertNotNull("the card has \"${screen.string("request_decision_accept")}\"; buttons: ${screen.allButtons()}", allow)
        for (button in listOf(deny!!, allow!!)) screen.atLeast48(button)
        assertTrue("both answer at once on a medium request", screen.enabled(deny) && screen.enabled(allow))
        assertTrue("a medium Allow answers on a tap", screen.clickable(allow))
    }

    @Test
    fun theCardsOneSignalIsItsHeaderWithTheKindInCapsAndTheTime() {
        val screen = queue(F3Live.APPROVAL)
        val kind = screen.string("needs_you_kind_command").uppercase()
        val header = screen.leavesWithText(kind).singleOrNull()
        assertNotNull("the header says the kind in caps, \"$kind\"; texts: ${screen.leaves.map { screen.text(it) }.filter { it.isNotBlank() }}", header)
        val head = screen.boundsDp(header!!)
        val clock = screen.leaves.firstOrNull { node ->
            val box = screen.boundsDp(node)
            time.matches(screen.text(node).trim()) && box.left > head.right - 1f && box.top < head.bottom && box.bottom > head.top
        }
        assertNotNull("the time on the header, at its right", clock)
        val style = screen.style(clock!!)!!
        assertEquals("the time is labelSmall, 11 sp", 11f, style.fontSize.value, 0.01f)
        assertEquals("the time is mono", OxeFonts.mono, style.fontFamily)
        assertTrue("the time has tabular figures (tnum): ${style.fontFeatureSettings}", style.fontFeatureSettings.orEmpty().contains("tnum"))
        val deny = screen.deny().single()
        assertTrue("the header is the card's top: above its buttons", head.bottom <= screen.boundsDp(deny).top + 1f)
        val badge = screen.string("request_risk_badge", screen.string("request_risk_medium"))
        assertTrue("no risk chip on the queue card (\"$badge\")", screen.merged.none { screen.label(it).contains(badge) })
        // rigor: source-assertion. Colours and icons are not in the semantics; the look is the re-recorded golden (MARCA).
        val code = PhoneScale.code("live/NeedsYou.kt")
        for (token in listOf("attnBg", "attnFg", "intentDangerBg", "intentDangerFg", "borderDefault", "OxeIcons.Sun")) {
            assertTrue("NeedsYou.kt draws the header with $token", Regex("""(?<![A-Za-z0-9_])${Regex.escape(token)}\b""").containsMatchIn(code))
        }
        for (gone in listOf("attnBorder", "RiskChip(", "RiskLine(", "fillMaxHeight()")) {
            assertFalse("NeedsYou.kt has no $gone (no orange border, no risk chip, no side strip)", code.contains(gone))
        }
        assertTrue("Negar is SECONDARY and Permitir uma vez PRIMARY", code.contains("OxeButtonKind.SECONDARY") && code.contains("OxeButtonKind.PRIMARY"))
    }

    // ---- CA-2 ----------------------------------------------------------------------------------------------------

    @Test
    fun aCriticalCardOffersOnlyReviewWhichOpensTheRequest() {
        fun RenderedScreen.review() = button(string("thread_review")).singleOrNull()
        val screen = queue(F3Live.CRITICAL) { it.tap(it.review()) }
        assertEquals("no Negar on a critical card", emptyList<String>(), screen.deny().map { screen.describe(it) })
        assertEquals("no Permitir on a critical card: the queue never allows nor holds", emptyList<String>(), screen.allow().map { screen.describe(it) })
        val review = screen.review()
        assertNotNull("a critical card has \"${screen.string("thread_review")}\"; buttons: ${screen.allButtons()}", review)
        screen.atLeast48(review!!)
        assertEquals("Revisar opens the Request screen", setOf("request:r-1"), opened.toSet())
        val header = "${screen.string("request_risk_critical").uppercase()} · ${screen.string("needs_you_kind_command").uppercase()}"
        assertTrue("the critical header is the catalog's \"$header\"; texts: ${screen.leaves.map { screen.text(it) }.filter { it.isNotBlank() }}", screen.leavesWithText(header).isNotEmpty())
    }

    @Test
    fun theAgentsTitleNeverLabelsACriticalRequest() {
        // Coordination 14/11 (approval safety, CR-F3-7): text the agent wrote never labels a critical request; the header
        // is the app's own catalog words, whatever the title says.
        val hostile = "LIMPAR CACHE"
        val screen = queue(F3Live.CRITICAL.replace("\"title\":\"Run the auth tests\"", "\"title\":\"$hostile\""))
        val critical = screen.string("request_risk_critical").uppercase()
        val header = "$critical · ${screen.string("needs_you_kind_command").uppercase()}"
        val texts = screen.leaves.map { screen.text(it) }.filter { it.isNotBlank() }
        assertTrue("the critical header is still \"$header\"; texts: $texts", screen.leavesWithText(header).isNotEmpty())
        assertTrue("the agent's title is not in the header: texts $texts", screen.leaves.none { screen.text(it).contains(critical) && screen.text(it).contains(hostile, ignoreCase = true) })
        assertEquals("still only Revisar", emptyList<String>(), (screen.deny() + screen.allow()).map { screen.describe(it) })
    }

    @Test
    fun onTheRequestScreenCriticalAllowWaitsTwoSecondsThenIsAHold() {
        val screen = requestScreen(F3Live.CRITICAL)
        val accept = screen.string("request_decision_accept")
        val allow = screen.buttons().filter { screen.label(it).trim().startsWith(accept) }
        assertEquals("one \"$accept\" on the Request screen; buttons: ${screen.allButtons()}", 1, allow.size)
        val node = allow.single()
        assertFalse("at open it waits the desktop's 2 s", screen.enabled(node))
        assertFalse("a tap never allows a critical request: no click action, the hold does", screen.clickable(node))
        assertEquals("it says it must be held", screen.string("request_hold_to_allow"), screen.stateDescription(node))
        val medium = requestScreen(F3Live.APPROVAL)
        val tap = medium.buttons().singleOrNull { medium.label(it).trim() == accept }
        assertNotNull("a medium request keeps a plain \"$accept\"", tap)
        assertTrue("a medium Allow answers on a tap", medium.clickable(tap!!) && medium.enabled(tap))
    }

    @Test
    fun theHoldIsOnePointTwoSecondsAfterTheDesktopsTwoSecondWait() {
        assertEquals("the wait is the desktop's APPROVAL_CRITICAL_ALLOW_DELAY_MS", 2_000L, CRITICAL_ALLOW_HOLD_MS)
        val kt = Class.forName("com.oxespace.mobile.ui.components.CriticalDelayAllowKt")
        assertEquals("the hold is the desktop's IMPACT_HOLD_MS (OXE-134 CA-2 / RT-2)", 1_200L, kt.getDeclaredField("CRITICAL_ALLOW_PRESS_MS").getLong(null))
        val progress = kt.getMethod("criticalAllowPressProgress", Long::class.javaPrimitiveType!!)
        fun at(ms: Long) = progress.invoke(null, ms) as Float
        assertEquals(0f, at(0), 0f)
        assertEquals(0f, at(-50), 0f)
        assertEquals(0.5f, at(600), 0.001f)
        assertTrue("1199 ms is not enough", at(1_199) < 1f)
        assertEquals(1f, at(1_200), 0f)
        assertEquals(1f, at(5_000), 0f)
    }

    @Test
    fun onTheRequestScreenTheRiskChipIsAboveTheTitle() {
        val screen = requestScreen(F3Live.CRITICAL)
        val badge = screen.string("request_risk_badge", screen.string("request_risk_critical"))
        val chip = screen.merged.firstOrNull { screen.label(it).trim() == badge }
        val title = screen.merged.firstOrNull { screen.isHeading(it) && screen.text(it).trim() == screen.string("request_kind_agent") }
        assertNotNull("the risk chip \"$badge\"", chip)
        assertNotNull("the request's title", title)
        assertTrue("the chip sits above the title", screen.boundsDp(chip!!).bottom <= screen.boundsDp(title!!).top + 1f)
    }

    // ---- CA-4 ----------------------------------------------------------------------------------------------------

    @Test
    fun aQuestionCardOffersOnlyReplyWhichOpensTheConversation() {
        fun RenderedScreen.reply() = button(string("needs_you_reply")).singleOrNull()
        val screen = queue(F3Live.QUESTION) { it.tap(it.reply()) }
        assertEquals("no Negar on a question", emptyList<String>(), screen.deny().map { screen.describe(it) })
        assertEquals("no Permitir on a question", emptyList<String>(), screen.allow().map { screen.describe(it) })
        val reply = screen.reply()
        assertNotNull("a question has \"${screen.string("needs_you_reply")}\"; buttons: ${screen.allButtons()}", reply)
        screen.atLeast48(reply!!)
        assertEquals("a question opens its conversation, not the Request screen", setOf("thread:t-1"), opened.toSet())
        val kind = screen.plural("needs_you_kind_questions", 1).uppercase()
        assertTrue("the header says \"$kind\"", screen.leavesWithText(kind).isNotEmpty())
    }

    @Test
    fun theQueueHasItsOwnHeaderNeedsYou() {
        val screen = queue(F3Live.APPROVAL)
        val title = screen.string("needs_you_title")
        assertTrue("the queue's header \"$title\" is a heading", screen.leaves.any { screen.text(it).trim() == title && screen.isHeading(it) })
    }

    // ---- CA-3 ----------------------------------------------------------------------------------------------------

    @Test
    fun offlineTheButtonsAreOffAndTheRowSaysWhy() {
        val screen = queue(F3Live.APPROVAL, banner = "Conexão com Studio perdida. Reconectando…")
        val deny = screen.deny().singleOrNull()
        val allow = screen.allow().singleOrNull()
        assertNotNull("offline the card keeps Negar; buttons: ${screen.allButtons()}", deny)
        assertNotNull("offline the card keeps Permitir uma vez; buttons: ${screen.allButtons()}", allow)
        assertFalse("Negar is off without the computer", screen.enabled(deny!!))
        assertFalse("Permitir uma vez is off without the computer", screen.enabled(allow!!))
        val why = screen.string("needs_you_offline")
        assertTrue("the row says why: \"$why\"", screen.leavesWithText(why).isNotEmpty())
    }

    @Test
    fun afterAnAnswerTheRowSaysAllowedOrDeniedAndAFailureSaysWhy() {
        val line = needsYou("needsYouAnswerLine", String::class.java, AnswerOutcome::class.java)
        fun of(decision: String, outcome: AnswerOutcome) = line.invoke(null, decision, outcome) as Int
        val done = AnswerOutcome.Sent(CommandResult.Done(null))
        assertEquals("accept went through: Permitido", stringId("needs_you_allowed"), of("accept", done))
        assertEquals("decline went through: Negado", stringId("needs_you_denied"), of("decline", done))
        assertEquals("nothing left the phone", stringId("needs_you_offline"), of("accept", AnswerOutcome.Sent(CommandResult.Offline)))
        assertEquals("answered elsewhere", R.string.request_refused_not_pending, of("accept", AnswerOutcome.Sent(CommandResult.Refused(RemoteErrorCode.NOT_PENDING))))
        assertEquals("the desktop said no", R.string.request_refused_other, of("decline", AnswerOutcome.Sent(CommandResult.Refused(RemoteErrorCode.INTERNAL))))
        assertEquals("no answer in time", R.string.request_refused_other, of("accept", AnswerOutcome.Sent(CommandResult.NoAnswer)))
        assertEquals("the confirmation was cancelled", R.string.request_not_confirmed, of("accept", AnswerOutcome.Blocked(AnswerBlock.NOT_CONFIRMED)))
    }

    @Test
    fun theRowAnswersThroughTheExistingConfirmation() {
        // rigor: source-assertion. The fingerprint / screen-lock prompt cannot run on the JVM; the row must use the
        // Request screen's own responder and gate (OXE-134 RT-3: no new prompt, the existing one is not removed).
        val code = PhoneScale.code("live/NeedsYou.kt")
        assertTrue("NeedsYou.kt answers through RequestResponder", Regex("""(?<![A-Za-z0-9_.])RequestResponder\(""").containsMatchIn(code))
        assertTrue("with the existing BiometricApprovalGate", Regex("""(?<![A-Za-z0-9_.])BiometricApprovalGate\(""").containsMatchIn(code))
    }

    @Test
    fun theRowWordsAreTheSpecsInBothLocales() {
        fun xml(dir: String, name: String) = Regex("""<string name="$name">([^<]*)</string>""").find(File("src/main/res/$dir/strings.xml").readText())?.groupValues?.get(1)
        assertEquals("Precisa de você", xml("values-pt-rBR", "needs_you_title"))
        assertEquals("Responder", xml("values-pt-rBR", "needs_you_reply"))
        assertEquals("Aprovar comando", xml("values-pt-rBR", "needs_you_kind_command"))
        assertEquals("Permitido", xml("values-pt-rBR", "needs_you_allowed"))
        assertEquals("Negado", xml("values-pt-rBR", "needs_you_denied"))
        assertEquals("Permitir uma vez", xml("values-pt-rBR", "request_decision_accept"))
        assertEquals("Needs you", xml("values", "needs_you_title"))
        assertEquals("Reply", xml("values", "needs_you_reply"))
        assertEquals("Approve command", xml("values", "needs_you_kind_command"))
        assertEquals("Allowed", xml("values", "needs_you_allowed"))
        assertEquals("Denied", xml("values", "needs_you_denied"))
        for (name in listOf("needs_you_offline", "request_hold_to_allow")) {
            assertFalse("$name in en", xml("values", name).isNullOrBlank())
            assertFalse("$name in pt-BR", xml("values-pt-rBR", name).isNullOrBlank())
        }
    }

    // ---- CA-5 ----------------------------------------------------------------------------------------------------

    @Test
    fun talkBackReadsWhoAsksForWhatThenDenyThenAllow() {
        val screen = queue(F3Live.APPROVAL)
        val deny = screen.deny().singleOrNull()
        val allow = screen.allow().singleOrNull()
        assertNotNull("TalkBack: Negar; buttons: ${screen.allButtons()}", deny)
        assertNotNull("TalkBack: Permitir uma vez; buttons: ${screen.allButtons()}", allow)
        val summary = screen.merged.filter { screen.label(it).startsWith("Claude") && screen.label(it).contains("npm test -- auth") }
        assertEquals("one stop reads \"Claude … npm test -- auth\"; stops: ${screen.merged.map { screen.label(it) }}", 1, summary.size)
        val said = screen.label(summary.single())
        assertFalse("the buttons are not read inside the summary", said.contains(screen.string("request_decision_decline")) || said.contains(screen.string("request_decision_accept")))
        val order = listOf(summary.single(), deny!!, allow!!).map { screen.boundsDp(it) }
        assertTrue("the summary comes before Negar", order[0].top <= order[1].top)
        assertTrue("Negar comes before Permitir uma vez", order[1].top < order[2].top || (order[1].top == order[2].top && order[1].left < order[2].left))
        assertEquals("Negar is said once", 1, screen.leavesWithText(screen.string("request_decision_decline")).size)
    }

    // ---- BRD-07 --------------------------------------------------------------------------------------------------

    @Test
    fun theRowFollowsThePhoneScale() {
        assertEquals("BRD-07 in NeedsYou.kt", emptyList<String>(), PhoneScale.offenders("live/NeedsYou.kt"))
        assertEquals("BRD-07 in CriticalDelayAllow.kt", emptyList<String>(), PhoneScale.offenders("components/CriticalDelayAllow.kt"))
        val small = queue(F3Live.APPROVAL, F3Live.QUESTION, F3Live.CRITICAL.replace("\"r-1\"", "\"r-3\"")).textSizes().filter { it.second < 11f }
        assertEquals("no text under 11 sp in the queue", emptyList<Pair<String, Float>>(), small)
        val header = queue(F3Live.APPROVAL).let { s -> s.leavesWithText(s.string("needs_you_kind_command").uppercase()).singleOrNull()?.let { s.style(it) } }
        assertNotNull("the header's kind is drawn", header)
        assertTrue("the header's kind is at least 11 sp", header!!.fontSize.value >= 11f)
    }

    private fun needsYou(name: String, vararg params: Class<*>) =
        Class.forName("com.oxespace.mobile.ui.live.NeedsYouKt").getMethod(name, *params)
}
