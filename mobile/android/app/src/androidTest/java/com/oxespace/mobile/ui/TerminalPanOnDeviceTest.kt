package com.oxespace.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.Presence
import com.oxespace.mobile.approval.PresenceGate
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.protocol.live.TerminalBuffer
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.live.TerminalScreen
import com.oxespace.mobile.ui.theme.OxeTheme
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frozen acceptance test for 1.5.0 CR-A45 (A45, OXE program, phase F10). Written by the planner; the executor must not
 * edit it. CCR: docs/roadmap-1.5/ccr-phone-terminal.md (#691) T-P3.1. A45's grid is exactly `cols` wide (2a0300e3);
 * this is what tells the person it pans: the edge hint "80 cols · swipe to pan" (HML-M1-8), and Aa to fit the width.
 * Nothing is clipped silently.
 *
 * Red at A45 (2a0300e3): neither the hint nor the fit toggle is drawn.
 */
@RunWith(AndroidJUnit4::class)
class TerminalPanOnDeviceTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val commands = LiveStreams().commands
    private val presence = PresenceGate { _, _ -> Presence.CONFIRMED }

    @Test
    fun aGridWiderThanThePhoneSaysItPansAndOffersToFitTheWidth() {
        val ansi = "$ ls\r\n" + "0123456789".repeat(8)
        val watched = Watched(TerminalBuffer()).apply {
            onSnapshot(listOf(RemoteFrames.json.parseToJsonElement("""{"data":"","truncated":false,"snapshot":{"ansi":${JsonPrimitive(ansi)},"cols":80,"rows":4}}""")))
        }
        compose.setContent { OxeTheme { TerminalScreen(RemotePane("p-1", "zsh", "terminal", phoneWrite = false), watched, commands, presence) {} } }
        val res = compose.activity.resources

        compose.onNode(hasText(res.getString(R.string.terminal_pan_hint, "80"))).assertExists()
        val fit = res.getString(R.string.terminal_fit_width)
        compose.onNode((hasText(fit) or hasContentDescription(fit)) and hasClickAction()).assertExists()
    }
}
