package com.oxespace.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.Presence
import com.oxespace.mobile.approval.PresenceGate
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.live.ConversationFetch
import com.oxespace.mobile.protocol.live.ConversationItem
import com.oxespace.mobile.protocol.live.ConversationPage
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.protocol.live.PaneConversation
import com.oxespace.mobile.protocol.live.TerminalBuffer
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.live.TerminalScreen
import com.oxespace.mobile.ui.theme.OxeTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frozen acceptance test for 1.5.0 CR-A46 (A46, OXE program, phase F10). Written by the planner; the executor must not
 * edit it. CCRs: #658 and docs/roadmap-1.5/ccr-phone-terminal.md (#691) T-P3.3, DESIGN M6.11–M6.15. On a pane with
 * `conversation: true` the terminal shows a Screen · Conversation control, opens on Conversation (read only: no input,
 * "Type on the Screen view"), with "Load earlier" while older pages exist. A pane without the field shows no control.
 *
 * Red before CR-A46: TerminalScreen draws only the screen; its `conversation` parameter is unused.
 */
@RunWith(AndroidJUnit4::class)
class PaneConversationViewOnDeviceTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val commands = LiveStreams().commands
    private val presence = PresenceGate { _, _ -> Presence.CONFIRMED }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val pane = RemotePane("p-1", "claude", "agent", agent = "claude", phoneWrite = false)

    @After
    fun tearDown() = scope.cancel()

    private fun conversation() = PaneConversation(scope = scope, fetch = { ConversationFetch.NoConversation }).apply {
        onSnapshot(ConversationPage(listOf(ConversationItem("native:1", "user", "Fix the login redirect"), ConversationItem("native:2", "assistant", "Fixed, and the tests pass.")), cursor = "c-1", epoch = 1))
    }

    @Test
    fun aPaneWithAConversationOpensOnItReadOnlyWithLoadEarlier() {
        val conversation = conversation()
        compose.setContent { OxeTheme { TerminalScreen(pane.copy(conversation = true), Watched(TerminalBuffer()), commands, presence, conversation = conversation) {} } }
        val res = compose.activity.resources

        compose.onNode(hasText(res.getString(R.string.pane_conversation_screen)) and hasClickAction()).assertExists()
        compose.onNode(hasText(res.getString(R.string.pane_conversation_conversation)) and hasClickAction()).assertExists()
        compose.onNode(hasText("Fixed, and the tests pass.")).assertExists()
        compose.onNode(hasText(res.getString(R.string.pane_conversation_type_on_screen))).assertExists()
        compose.onNode(hasText(res.getString(R.string.pane_conversation_load_earlier)) and hasClickAction()).assertExists()
        // Read only: Conversation offers no field to type in.
        compose.onNode(hasSetTextAction()).assertDoesNotExist()
    }

    @Test
    fun aPaneWithoutTheFieldShowsNoConversationControl() {
        compose.setContent { OxeTheme { TerminalScreen(pane, Watched(TerminalBuffer()), commands, presence) {} } }
        val res = compose.activity.resources
        compose.onNode(hasText(res.getString(R.string.pane_conversation_conversation)) and hasClickAction()).assertDoesNotExist()
    }
}
