package com.oxespace.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.live.RequestScreen
import com.oxespace.mobile.ui.live.requestActions
import com.oxespace.mobile.ui.theme.OxeTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frozen acceptance test for 1.5.0 CR-F10-3 (A44, OXE program, phase F10). Written by the planner; the executor must not
 * edit it. MOBILE's T4 review: `requestActions(request, elapsedMs)` is implemented, but RequestScreen drew its buttons
 * from its own loop. Here the real screen, composed on a device, must draw exactly the actions requestActions gives:
 * which decisions appear, and whether Allow can be pressed yet.
 *
 * Red at T4 (f877342d): on a truncated approval the screen's own filter keeps Deny AND Cancel (RequestScreen.kt:199),
 * while requestActions keeps Deny only (A44: a truncated request can only be refused; parity rule S3).
 */
@RunWith(AndroidJUnit4::class)
class RequestScreenActionsOnDeviceTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val commands = LiveStreams().commands
    private val request = RemotePendingRequest(
        threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = "r-1", generation = 1,
        kind = "approval", title = "Delete the build output", command = "rm -rf dist", decisions = listOf("accept", "decline", "cancel"),
        answerable = true, createdAt = 1,
    )

    private val labels by lazy {
        val res = compose.activity.resources
        mapOf(
            "accept" to res.getString(R.string.request_decision_accept),
            "decline" to res.getString(R.string.request_decision_decline),
            "cancel" to res.getString(R.string.request_decision_cancel),
        )
    }

    private fun show(shown: RemotePendingRequest) {
        compose.setContent { OxeTheme { RequestScreen(request = shown, commands = commands, onBack = {}) } }
        compose.waitForIdle()
    }

    /** The answer buttons the screen draws, by decision. */
    private fun drawnDecisions(): Set<String> = labels.filterValues { label ->
        compose.onAllNodes(hasText(label) and hasClickAction()).fetchSemanticsNodes().isNotEmpty()
    }.keys

    @Test
    fun aTruncatedApprovalDrawsExactlyTheActionsRequestActionsGives() {
        val truncated = request.copy(risk = "low", truncated = true)
        show(truncated)
        val expected = requestActions(truncated, elapsedMs = 60_000).map { it.decision }.toSet()
        assertEquals(setOf("decline"), expected)
        assertEquals("the screen draws requestActions, not its own filter", expected, drawnDecisions())
    }

    @Test
    fun aCriticalAllowIsEnabledWhenRequestActionsSaysSoAndNotBefore() {
        val critical = request.copy(risk = "critical")
        compose.mainClock.autoAdvance = false
        show(critical)
        assertEquals(false, requestActions(critical, elapsedMs = 0).single { it.decision == "accept" }.enabled)
        compose.onNode(hasText(labels.getValue("accept")) and hasClickAction()).assertIsNotEnabled()
        compose.onNode(hasText(labels.getValue("decline")) and hasClickAction()).assertIsEnabled()

        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        assertEquals(true, requestActions(critical, elapsedMs = 2_000).single { it.decision == "accept" }.enabled)
        compose.onNode(hasText(labels.getValue("accept")) and hasClickAction()).assertIsEnabled()
    }

    @Test
    fun aRequestOnlyTheDesktopCanAnswerDrawsNoAnswerButtons() {
        val desktopOnly = request.copy(answerable = false)
        show(desktopOnly)
        assertTrue(requestActions(desktopOnly, elapsedMs = 60_000).isEmpty())
        assertEquals(emptySet<String>(), drawnDecisions())
    }
}
