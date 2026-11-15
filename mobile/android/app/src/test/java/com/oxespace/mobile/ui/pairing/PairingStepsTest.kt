package com.oxespace.mobile.ui.pairing

import androidx.activity.OnBackPressedDispatcher
import androidx.activity.OnBackPressedDispatcherOwner
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.cash.paparazzi.Paparazzi
import com.oxespace.mobile.pairing.PairingFailure
import com.oxespace.mobile.pairing.PairingState
import com.oxespace.mobile.ui.f4.Screen
import com.oxespace.mobile.ui.f4.catalog
import com.oxespace.mobile.ui.f4.f4Paparazzi
import com.oxespace.mobile.ui.f4.render
import com.oxespace.mobile.ui.f4.uiCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A14 (OXE program oxespace-152-mobile, phase F4, Jira OXE-102 / BRD-24 F2,
 * MOB-7: pairing as numbered steps). Written by the planner; the executor must not edit it.
 *
 * The target is MARCA's approved phone playground in Mandacaru Noite (artefact JpDiD9nKrPrMXdcnkED4US, Celular; the
 * Pairing mock of oxespace-152-brand/.brand-audit/live/celular.html, "Fica: o código em seis caixas, 3 + 3, e os
 * quatro passos. Muda: a barra fina de passos vira círculos numerados; o passo 2 se chama Reach; há voltar, título"):
 * - a top bar on every pairing state: a back button (pairing_back, "Back" / "Voltar", at least 48 x 48 dp) at the left
 *   of the title "Pair with your computer" (pairing_title, a heading), both above the steps;
 * - Back does what the phone's Back does: it goes through the OnBackPressedDispatcher, so MainActivity's BackHandler
 *   leaves pairing (no new parameter on PairingScreen);
 * - the four steps are numbered circles (the done ones with a check), no longer the thin 4 dp bars; step 2 is called
 *   "Reach" (pairing_step_connect); the steps stay one stop for TalkBack ("3/4: Confirm");
 * - while the computer is asked to confirm, the six code boxes stay, and a Cancel button (pairing_cancel, "Cancel" /
 *   "Cancelar", at least 48 dp tall) below them leaves pairing as Back does;
 * - nothing under 11 sp (BRD-07): the guard PairingStepsGuardTest below, green on main.
 * The time left on the code ("The code expires in 1:48") is not here: the phone does not know when the code expires
 * (PairingQr has no expiry). That part of MOB-7 is a divergence asked of MARCA.
 *
 * Red at F4 @ origin/main 4fabc30f5: no back button on any state, the title is a line of the scanning state only, below
 * the steps; the steps are thin bars with "Connect"; the confirm state has no Cancel.
 */
class PairingStepsTest {
    @get:Rule
    val paparazzi = f4Paparazzi()

    private val host = PairingHost(paparazzi)

    private fun pairing(state: PairingState, act: (Screen) -> Unit = {}): Screen = host.render(state, act)

    private fun Screen.back() = button(string("pairing_back"))

    @Test
    fun everyStateHasTheTopBarWithBackAndTheTitle() {
        for ((name, state) in STATES) {
            host.backs = 0
            var tapped = false
            val screen = pairing(state) { s -> if (!tapped) s.back()?.let { tapped = true; s.tap(it) } }
            val back = screen.back()
            assertNotNull("$name: a back button \"${screen.string("pairing_back")}\"; buttons: ${screen.buttons().map { screen.describe(it) }}", back)
            assertTrue("$name: ${screen.describe(back!!)} is at least 48 x 48 dp", screen.widthDp(back) >= 47.5f && screen.heightDp(back) >= 47.5f)
            val title = screen.leavesWithText(screen.string("pairing_title")).firstOrNull { screen.isHeading(it) }
            assertNotNull("$name: the title \"${screen.string("pairing_title")}\" is a heading", title)
            val backBox = screen.boundsDp(back)
            val titleBox = screen.boundsDp(title!!)
            assertTrue("$name: Back is at the title's left, on its line", backBox.right <= titleBox.left + 1f && backBox.top < titleBox.bottom && backBox.bottom > titleBox.top)
            val steps = screen.merged.firstOrNull { Regex("""^[1-4]/4: """).containsMatchIn(screen.label(it)) }
            assertNotNull("$name: the steps are one stop for TalkBack (\"N/4: …\")", steps)
            assertTrue("$name: the top bar is above the steps", titleBox.bottom <= screen.boundsDp(steps!!).top + 1f)
            assertTrue("$name: Back does what the phone's Back does (OnBackPressedDispatcher)", host.backs > 0)
        }
    }

    @Test
    fun theStepsAreNumberedCirclesAndStepTwoIsReach() {
        assertEquals("Scan", catalog("values", "pairing_step_scan"))
        assertEquals("Reach", catalog("values", "pairing_step_connect"))
        assertEquals("Confirm", catalog("values", "pairing_step_confirm"))
        assertEquals("Done", catalog("values", "pairing_step_done"))
        val screen = pairing(PairingState.Waiting("Studio", "28T5CY"))
        val confirm = screen.string("pairing_step_confirm")
        assertTrue("the steps say where the pairing stands: \"3/4: $confirm\"", screen.merged.any { screen.label(it) == "3/4: $confirm" })
        // rigor: source-assertion. A circle and its number are drawn, not read by TalkBack (the steps are one stop).
        val code = uiCode("components/Pairing.kt")
        val start = code.indexOf("fun PairingStepper(")
        assertTrue("PairingStepper exists", start >= 0)
        val end = code.indexOf("\n}", start).let { if (it < 0) code.length else it }
        val stepper = code.substring(start, end)
        assertTrue("each step is a circle (CircleShape)", stepper.contains("CircleShape"))
        assertFalse("the thin 4 dp bar is gone", Regex("""\.height\(4\.dp\)""").containsMatchIn(stepper))
    }

    @Test
    fun confirmingKeepsTheCodeAndOffersCancel() {
        host.backs = 0
        var tapped = false
        val screen = pairing(PairingState.Waiting("Studio", "28T5CY")) { s -> if (!tapped) s.button(s.string("pairing_cancel"))?.let { tapped = true; s.tap(it) } }
        val spoken = screen.string("pairing_verification_description", "2 8 T 5 C Y")
        val code = screen.merged.firstOrNull { screen.label(it) == spoken }
        assertNotNull("the six code boxes, read one character at a time", code)
        val cancel = screen.button(screen.string("pairing_cancel"))
        assertNotNull("Cancel \"${screen.string("pairing_cancel")}\"; buttons: ${screen.buttons().map { screen.describe(it) }}", cancel)
        assertTrue("${screen.describe(cancel!!)} is at least 48 dp tall", screen.heightDp(cancel) >= 47.5f)
        assertTrue("Cancel is below the code", screen.boundsDp(cancel).top >= screen.boundsDp(code!!).bottom - 1f)
        assertTrue("Cancel leaves pairing as Back does (OnBackPressedDispatcher)", host.backs > 0)
        assertEquals("Cancel", catalog("values", "pairing_cancel"))
        assertEquals("Cancelar", catalog("values-pt-rBR", "pairing_cancel"))
        assertEquals("Back", catalog("values", "pairing_back"))
        assertEquals("Voltar", catalog("values-pt-rBR", "pairing_back"))
    }
}

/** Guard of A14, green on main (not in the criterion's proof). Frozen with PairingStepsTest; the executor must not edit it. */
class PairingStepsGuardTest {
    @get:Rule
    val paparazzi = f4Paparazzi()

    private val host = PairingHost(paparazzi)

    private fun pairing(state: PairingState): Screen = host.render(state) {}

    @Test
    fun pairingFollowsThePhoneScale() {
        for ((name, state) in STATES) {
            val small = pairing(state).textSizes().filter { it.second < 11f }
            assertEquals("no text under 11 sp while $name", emptyList<Pair<String, Float>>(), small)
        }
    }
}

private val STATES = listOf(
    "scanning" to PairingState.Scanning,
    "contacting" to PairingState.Contacting("Studio"),
    "waiting" to PairingState.Waiting("Studio", "28T5CY"),
    "failed" to PairingState.Failed(PairingFailure.TIMED_OUT),
)

/** The pairing screen with an OnBackPressedDispatcher that counts what reaches it, as MainActivity's BackHandler would. */
private class PairingHost(private val paparazzi: Paparazzi) {
    var backs = 0

    @Composable
    private fun WithBack(content: @Composable () -> Unit) {
        val hostLifecycle = LocalLifecycleOwner.current.lifecycle
        val owner = remember {
            object : OnBackPressedDispatcherOwner {
                override val onBackPressedDispatcher = OnBackPressedDispatcher(Runnable { backs++ })
                override val lifecycle: Lifecycle get() = hostLifecycle
            }
        }
        CompositionLocalProvider(LocalOnBackPressedDispatcherOwner provides owner) { content() }
    }

    fun render(state: PairingState, act: (Screen) -> Unit): Screen = paparazzi.render(act = act) {
        WithBack { PairingScreen(state, {}, {}) { modifier -> Box(modifier) } }
    }
}
