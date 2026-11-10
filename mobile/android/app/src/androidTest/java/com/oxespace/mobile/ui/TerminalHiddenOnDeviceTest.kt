package com.oxespace.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.Presence
import com.oxespace.mobile.approval.PresenceGate
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.live.TerminalBuffer
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.live.TerminalScreen
import com.oxespace.mobile.ui.theme.OxeTheme
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frozen acceptance test for 1.5.0 CR-CR34 (CR-34, OXE program, phase F10). Written by the planner; the executor must not
 * edit it. DESIGN (08/11): an open pane that the desktop hides from the phone is replaced by an info Notice, "This
 * terminal was hidden from the phone on {computer}." with [Back to terminals], and nothing of the pane stays on screen,
 * the last frame included. The phone's protocol side is PaneHiddenTest; this is the screen.
 *
 * Red before CR-CR34: TerminalScreen keeps drawing the last frame, and its `computer` parameter is unused.
 */
@RunWith(AndroidJUnit4::class)
class TerminalHiddenOnDeviceTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()
    private val desk = ScreenDesk()

    @After
    fun tearDown() = desk.close()

    @Test
    fun aPaneHiddenFromThePhoneIsReplacedByTheNoticeAndNothingOfItStays() {
        val secret = "deploy --to production"
        desk.serve(RemoteSubscription.TERMINAL, desk.json("""{"data":${JsonPrimitive("$ $secret\r\n")},"truncated":false}"""))
        val watched = Watched(TerminalBuffer())
        desk.streams.follow(RemoteSubscription.TERMINAL, "p-1", watched)
        desk.connect()
        desk.settle()
        compose.setContent {
            OxeTheme { TerminalScreen(RemotePane("p-1", "zsh", "terminal", phoneWrite = false), watched, desk.streams.commands, PresenceGate { _, _ -> Presence.CONFIRMED }, computer = "Studio") {} }
        }
        compose.waitUntil(10_000) { compose.onAllNodes(hasText(secret, substring = true)).fetchSemanticsNodes().isNotEmpty() }

        desk.end(RemoteSubscription.TERMINAL, "p-1", RemoteErrorCode.NOT_FOUND, "pane-hidden")
        compose.waitForIdle()
        val res = compose.activity.resources
        compose.onNode(hasText(res.getString(R.string.terminal_hidden_on_desktop, "Studio"))).assertExists()
        compose.onNode(hasText(res.getString(R.string.terminal_hidden_back)) and hasClickAction()).assertExists()
        compose.onNode(hasText(secret, substring = true)).assertDoesNotExist()
    }
}
