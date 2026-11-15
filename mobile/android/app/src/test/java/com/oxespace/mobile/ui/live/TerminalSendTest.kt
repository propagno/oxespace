package com.oxespace.mobile.ui.live

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import com.oxespace.mobile.protocol.live.LiveStreams
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
 * Frozen acceptance test for 1.5.2 Celular A10 (OXE program oxespace-152-mobile, phase F3, Jira OXE-102 / BRD-24 F1,
 * CA-4: the terminal at night, and Send next to the field). Written by the planner; the executor must not edit it.
 *
 * - Send (terminal_input_send) is off while the field is empty: the Enter key of the key row (TerminalKey.ENTER, F2 A6)
 *   covers a bare Enter. With text it sends the text, then Enter (F2's terminalPieces, unchanged).
 * - Send has the field's height (a difference of at most 1 dp) and a touch target of at least 48 x 48 dp, in both themes.
 * - The terminal body keeps the night palette in both themes (DarkOxeColors.termBg / term*; MOB-2, already on main).
 * - BRD-07 (OXE-69) in TerminalScreen.kt: nothing under 11 sp, radii only OxeRadius.
 * F2's frozen TerminalEnterTest stays green: terminalPieces("") is still ["\r"]; only the button stops offering it.
 *
 * Red at F3 @ origin/main f417a86f0: Send is on with an empty field (T18-c sent Enter with it), and it is 48 dp tall
 * beside a 56 dp OutlinedTextField.
 */
class TerminalSendTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private fun terminal(night: Boolean = false): RenderedScreen = paparazzi.render(night) {
        TerminalScreen(Samples.pane, Samples.terminal(), LiveStreams().commands, Samples.presence) {}
    }

    private fun RenderedScreen.send() = buttons().singleOrNull { label(it).trim() == string("terminal_input_send") }

    private fun RenderedScreen.field() = merged.singleOrNull { it.config.getOrNull(SemanticsActions.SetText) != null }

    @Test
    fun sendIsOffWhileTheFieldIsEmpty() {
        val screen = terminal()
        val send = screen.send()
        assertNotNull("the terminal input has Send; buttons: ${screen.buttons().map { screen.describe(it) }}", send)
        assertFalse("Send is off with an empty field (the Enter key covers a bare Enter)", screen.enabled(send!!))
        val enter = screen.buttons().filter { screen.label(it).contains(TerminalKey.entries.single { key -> key.name == "ENTER" }.label) }
        assertTrue("the key row still has the Enter key", enter.isNotEmpty())
    }

    @Test
    fun sendIsAsTallAsTheFieldAndAtLeast48dp() {
        for (night in listOf(false, true)) {
            val screen = terminal(night)
            val send = screen.send()
            val field = screen.field()
            assertNotNull("Send", send)
            assertNotNull("the field", field)
            val difference = kotlin.math.abs(screen.heightDp(send!!) - screen.heightDp(field!!))
            assertTrue("night=$night: Send ${screen.heightDp(send)} dp and the field ${screen.heightDp(field)} dp differ by at most 1 dp", difference <= 1f)
            assertTrue("night=$night: Send is at least 48 dp tall", screen.heightDp(send) >= 47.5f)
            assertTrue("night=$night: Send is at least 48 dp wide", screen.widthDp(send) >= 47.5f)
        }
    }

    @Test
    fun theTerminalKeepsTheNightPaletteAndThePhoneScale() {
        val code = PhoneScale.code("live/TerminalScreen.kt")
        assertTrue("the terminal body is drawn on DarkOxeColors.termBg in both themes (MOB-2)", code.contains("DarkOxeColors.termBg"))
        assertEquals("BRD-07 in TerminalScreen.kt", emptyList<String>(), PhoneScale.offenders("live/TerminalScreen.kt"))
        val small = terminal().textSizes().filter { it.second < 11f }
        assertEquals("no text under 11 sp on the terminal screen", emptyList<Pair<String, Float>>(), small)
    }
}
