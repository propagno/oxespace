package com.oxespace.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.Presence
import com.oxespace.mobile.approval.PresenceGate
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.protocol.live.ThreadTimeline
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.live.ThreadScreen
import com.oxespace.mobile.ui.theme.OxeTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frozen acceptance test for 1.5.0 CR-A47 (A47, OXE program, phase F10). Written by the planner; the executor must not
 * edit it. CCR: docs/roadmap-1.5/ccr-phone-agents-steer.md (#689) T-P2.2. A47's composer logic is done (7c3499f9); this is
 * the layout DESIGN approved: while the agent works the field shows Stop (secondary) · text · Send the instruction, and
 * without canSteer Send queues, with the placeholder "Queued until the current step ends".
 *
 * Red at A47 (7c3499f9): Stop shows only while the field is empty (ThreadScreen.kt `running && !typed`), and there is no
 * queued placeholder.
 */
@RunWith(AndroidJUnit4::class)
class SteerComposerOnDeviceTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val commands = LiveStreams().commands
    private val presence = PresenceGate { _, _ -> Presence.CONFIRMED }

    private fun working(canSteer: Boolean) = Watched(ThreadTimeline()).apply {
        onSnapshot(listOf(RemoteFrames.json.parseToJsonElement(
            """{"thread":{"id":"t-1","workspaceId":"w-1","title":"Fix the login","provider":"claude","status":"running","pendingRequests":0,"updatedAt":5,"queued":0,"canSteer":$canSteer},"hasMore":false,"items":[]}""",
        )))
    }

    @Test
    fun whileTheAgentWorksStopAndSendTheInstructionShowTogetherWithTextTyped() {
        compose.setContent { OxeTheme { ThreadScreen("t-1", working(canSteer = true), commands, presence, connected = true) {} } }
        val res = compose.activity.resources
        compose.onNode(hasSetTextAction()).performTextInput("also add a test")
        compose.waitForIdle()
        compose.onNode(hasContentDescription(res.getString(R.string.thread_stop_turn)) and hasClickAction()).assertExists()
        compose.onNode(hasText(res.getString(R.string.composer_steer)) and hasClickAction()).assertExists()
    }

    @Test
    fun withoutCanSteerTheFieldSaysSendIsQueuedUntilTheStepEnds() {
        compose.setContent { OxeTheme { ThreadScreen("t-1", working(canSteer = false), commands, presence, connected = true) {} } }
        val res = compose.activity.resources
        compose.onNode(hasText(res.getString(R.string.composer_queued_placeholder))).assertExists()
        compose.onNode(hasContentDescription(res.getString(R.string.thread_stop_turn)) and hasClickAction()).assertExists()
    }
}
