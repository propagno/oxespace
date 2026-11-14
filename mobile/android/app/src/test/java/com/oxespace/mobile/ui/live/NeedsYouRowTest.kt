package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import com.oxespace.mobile.approval.AnswerBlock
import com.oxespace.mobile.approval.AnswerOutcome
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.live.CommandResult
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.PhoneScale
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import com.oxespace.mobile.ui.stringId
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A7 (OXE program oxespace-152-mobile, phase F3, Jira OXE-134 inside BRD-24 /
 * OXE-102). Written by the planner; the executor must not edit it.
 *
 * In the "Precisa de você" tab, a permission request is answered on its own row, without opening anything: "Negar" and
 * "Permitir" on the row, each at least 48 x 48 dp (CA-1); at critical risk "Permitir" needs a hold of 600 ms with
 * progress, and letting go earlier cancels (CA-2); the answer goes through the existing protocol and the same
 * RequestResponder as the Request screen, and the row then says "Permitido" or "Negado"; offline or after an error the
 * buttons are off and the row says why (CA-3); a request that is not a permission (an open or multiple-choice question)
 * gets no buttons and its row opens the conversation (CA-4); TalkBack reads "<agente> pede para <ação>", then "Negar",
 * then "Permitir", each button with its own label (CA-5). Goldens (CA-6) are re-recorded by ci/record-phone-goldens.
 *
 * Contract (rendered through LiveHome; new symbols read by name so this file compiles on main):
 * - new file ui/live/NeedsYou.kt (class NeedsYouKt) with
 *   `const val NEEDS_YOU_HOLD_MS = 600L`,
 *   `fun needsYouHoldProgress(heldMs: Long): Float` (0 at 0 or less, heldMs / 600 in between, 1 from 600 on), and
 *   `fun needsYouAnswerLine(decision: String, outcome: AnswerOutcome): Int`, the R.string the row shows after an answer;
 * - strings (values and values-pt-rBR): needs_you_allow ("Allow" / "Permitir"), needs_you_allowed ("Allowed" /
 *   "Permitido"), needs_you_denied ("Denied" / "Negado"), needs_you_offline (why the buttons are off without the
 *   computer), needs_you_hold_to_allow (the hold hint, read as the critical Allow's state). "Negar" is the existing
 *   request_decision_decline;
 * - the critical Allow is still a node with Role.Button labelled "Permitir" and stateDescription = the hold hint, but
 *   with no click action (a tap never allows; the hold does); a non-critical Allow answers on a tap.
 * Brand (BRD-24 F1, BRD-07/OXE-69): the buttons are the OxeButton anatomy (48 dp, OxeRadius.lg), Deny SECONDARY and
 * Allow PRIMARY on a non-critical row, colours by token in both themes; no text under 11 sp, radii only OxeRadius.
 *
 * Red at F3 @ origin/main f417a86f0: the row has no button at all (the whole row opens the Request screen), a question
 * row opens the Request screen, and NeedsYou.kt does not exist.
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

    private fun RenderedScreen.button(label: String) = buttons().filter { label(it).trim() == label }

    private fun RenderedScreen.deny() = button(string("request_decision_decline"))

    private fun RenderedScreen.allow() = button(string("needs_you_allow"))

    private fun RenderedScreen.denyOn(what: String) = deny().singleOrNull()
        ?: throw AssertionError("$what: the row has no \"${string("request_decision_decline")}\" button; buttons: ${buttons().map { describe(it) }}")

    // ---- CA-1 ----------------------------------------------------------------------------------------------------

    @Test
    fun aPermissionRowShowsDenyAndAllowOfAtLeast48dp() {
        val screen = queue(F3Live.APPROVAL)
        val deny = screen.denyOn("a permission request")
        val allow = screen.allow().singleOrNull()
        assertNotNull("the row has a \"${screen.string("needs_you_allow")}\" button; buttons: ${screen.buttons().map { screen.describe(it) }}", allow)
        for (button in listOf(deny, allow!!)) {
            assertTrue("${screen.describe(button)} is at least 48 dp wide", screen.widthDp(button) >= 47.5f)
            assertTrue("${screen.describe(button)} is at least 48 dp tall", screen.heightDp(button) >= 47.5f)
        }
        assertTrue("both answer at once on a medium request", screen.enabled(deny) && screen.enabled(allow))
    }

    // ---- CA-4 ----------------------------------------------------------------------------------------------------

    @Test
    fun aRowThatIsNotAPermissionHasNoButtonsAndOpensTheConversation() {
        fun RenderedScreen.row() = string("request_kind_question").let { title -> buttons().firstOrNull { text(it).contains(title) || label(it).contains(title) } }
        val screen = queue(F3Live.QUESTION) { it.tap(it.row()) }
        assertEquals("no Negar on a question", emptyList<String>(), screen.deny().map { screen.describe(it) })
        assertNotNull("the question's row can be tapped; buttons: ${screen.buttons().map { screen.describe(it) }}", screen.row())
        assertEquals("a question opens its conversation, not the Request screen", setOf("thread:t-1"), opened.toSet())
    }

    // ---- CA-3 ----------------------------------------------------------------------------------------------------

    @Test
    fun offlineTheButtonsAreOffAndTheRowSaysWhy() {
        val screen = queue(F3Live.APPROVAL, banner = "Conexão com Studio perdida. Reconectando…")
        val deny = screen.denyOn("offline")
        val allow = screen.allow().single()
        assertFalse("Negar is off without the computer", screen.enabled(deny))
        assertFalse("Permitir is off without the computer", screen.enabled(allow))
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
    fun theRowWordsAreTheSpecsInBothLocales() {
        fun xml(dir: String, name: String) = Regex("""<string name="$name">([^<]*)</string>""").find(File("src/main/res/$dir/strings.xml").readText())?.groupValues?.get(1)
        assertEquals("Permitir", xml("values-pt-rBR", "needs_you_allow"))
        assertEquals("Permitido", xml("values-pt-rBR", "needs_you_allowed"))
        assertEquals("Negado", xml("values-pt-rBR", "needs_you_denied"))
        assertEquals("Allow", xml("values", "needs_you_allow"))
        assertEquals("Allowed", xml("values", "needs_you_allowed"))
        assertEquals("Denied", xml("values", "needs_you_denied"))
        for (name in listOf("needs_you_offline", "needs_you_hold_to_allow")) {
            assertFalse("$name in en", xml("values", name).isNullOrBlank())
            assertFalse("$name in pt-BR", xml("values-pt-rBR", name).isNullOrBlank())
        }
    }

    // ---- CA-2 ----------------------------------------------------------------------------------------------------

    @Test
    fun criticalAllowIsAHoldNotATap() {
        val screen = queue(F3Live.CRITICAL)
        screen.denyOn("a critical request")
        val allow = screen.allow().singleOrNull()
        assertNotNull("a critical row has Permitir too", allow)
        assertEquals("the critical Allow says it must be held", screen.string("needs_you_hold_to_allow"), screen.stateDescription(allow!!))
        assertFalse("a tap never allows a critical request", screen.clickable(allow))
        val medium = queue(F3Live.APPROVAL).allow().single()
        assertTrue("a medium Allow answers on a tap", screen.clickable(medium))
    }

    @Test
    fun theHoldFillsOverSixHundredMillisecondsAndLettingGoEarlyCancels() {
        val progress = needsYou("needsYouHoldProgress", Long::class.javaPrimitiveType!!)
        fun at(ms: Long) = progress.invoke(null, ms) as Float
        assertEquals(0f, at(0), 0f)
        assertEquals(0f, at(-50), 0f)
        assertEquals(0.5f, at(300), 0.001f)
        assertTrue("599 ms is not enough", at(599) < 1f)
        assertEquals(1f, at(600), 0f)
        assertEquals(1f, at(5_000), 0f)
    }

    @Test
    fun theHoldIsSixHundredMilliseconds() {
        val field = Class.forName("com.oxespace.mobile.ui.live.NeedsYouKt").getDeclaredField("NEEDS_YOU_HOLD_MS")
        assertEquals("OXE-134 CA-2 / RT-2", 600L, field.getLong(null))
    }

    // ---- CA-5 ----------------------------------------------------------------------------------------------------

    @Test
    fun talkBackReadsWhoAsksForWhatThenDenyThenAllow() {
        val screen = queue(F3Live.APPROVAL)
        val deny = screen.denyOn("TalkBack")
        val allow = screen.allow().single()
        val summary = screen.merged.filter { screen.label(it).startsWith("Claude") && screen.label(it).contains("npm test -- auth") }
        assertEquals("one stop reads \"Claude … npm test -- auth\"; stops: ${screen.merged.map { screen.label(it) }}", 1, summary.size)
        val said = screen.label(summary.single())
        assertFalse("the buttons are not read inside the summary", said.contains(screen.string("request_decision_decline")) || said.contains(screen.string("needs_you_allow")))
        val order = listOf(summary.single(), deny, allow).map { screen.boundsDp(it) }
        assertTrue("the summary comes before Negar", order[0].top <= order[1].top)
        assertTrue("Negar comes before Permitir", order[1].top < order[2].top || (order[1].top == order[2].top && order[1].left < order[2].left))
        assertEquals("Negar is said once", 1, screen.leavesWithText(screen.string("request_decision_decline")).size)
    }

    // ---- BRD-07 --------------------------------------------------------------------------------------------------

    @Test
    fun theRowFollowsThePhoneScale() {
        assertEquals("BRD-07 in NeedsYou.kt", emptyList<String>(), PhoneScale.offenders("live/NeedsYou.kt"))
        val small = queue(F3Live.APPROVAL, F3Live.QUESTION).textSizes().filter { it.second < 11f }
        assertEquals("no text under 11 sp in the queue", emptyList<Pair<String, Float>>(), small)
    }

    private fun needsYou(name: String, vararg params: Class<*>) =
        Class.forName("com.oxespace.mobile.ui.live.NeedsYouKt").getMethod(name, *params)
}
