package com.oxespace.mobile.ui.live

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.input.ImeAction
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.Samples
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test

/**
 * OXE-384 (b): the keyboard's own action key on the terminal's field is Send, and it sends the line as the Send button
 * does. Before, the field had the default action, so Gboard's Enter on a single-line field did nothing and the person
 * had to reach for the button. Nothing visible in the app changes: the key belongs to the keyboard.
 */
class TerminalImeSendTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private fun terminal(): RenderedScreen = paparazzi.render {
        TerminalScreen(Samples.pane, Samples.terminal(), LiveStreams().commands, Samples.presence) {}
    }

    @Test
    fun theTerminalFieldsKeyboardActionIsSend() {
        val screen = terminal()
        val field = screen.merged.singleOrNull { it.config.getOrNull(SemanticsActions.SetText) != null }
        assertNotNull("the terminal input field", field)
        assertEquals("the keyboard's action key on the terminal field", ImeAction.Send, field!!.config.getOrNull(SemanticsProperties.ImeAction))
        assertNotNull("the field handles its keyboard action", field.config.getOrNull(SemanticsActions.OnImeAction))
    }
}
