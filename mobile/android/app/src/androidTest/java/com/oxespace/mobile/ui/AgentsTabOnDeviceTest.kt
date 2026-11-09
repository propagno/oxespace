package com.oxespace.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.session.LiveRepository
import com.oxespace.mobile.ui.live.LiveHome
import com.oxespace.mobile.ui.theme.OxeTheme
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frozen acceptance test for 1.5.0 CR-A43 (A43, OXE program, phase F10). Written by the planner; the executor must not
 * edit it. CCR: docs/roadmap-1.5/ccr-phone-agents-steer.md (#689) T-P2.1. A43's store and model are done (84cf98b3);
 * this is the tab a person reaches: LiveHome has an Agents tab that lists the desktop's agents from the real `agents`
 * topic, with the five chips by state (DESIGN M7.7).
 *
 * Red at A43 (84cf98b3): LiveTab is { THREADS, REQUESTS, TERMINALS, TASKS }; there is no Agents tab to tap.
 */
@RunWith(AndroidJUnit4::class)
class AgentsTabOnDeviceTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()
    private val desk = ScreenDesk()

    @After
    fun tearDown() = desk.close()

    private fun row(kind: String, id: String, state: String, rev: Int, title: String) =
        """{"kind":"$kind","id":"$id","rev":$rev,"state":"$state","provider":"claude","title":"$title","since":1000}"""

    @Test
    fun theAgentsTabListsTheDesktopsAgentsWithTheFiveChips() {
        desk.serve(RemoteSubscription.AGENTS, desk.json("""{"rows":[${row("thread", "t-docs", "finished", 1, "Write the docs")},${row("pane", "p-1", "working", 2, "Run the build")}],"unavailable":[]}"""))
        val live = LiveRepository(desk.streams)
        desk.connect()
        desk.settle()
        compose.setContent { OxeTheme { LiveHome("Studio", null, live, {}, {}, {}, {}, {}) } }
        val res = compose.activity.resources

        compose.onNode(hasText(res.getString(R.string.live_tabs_agents)) and hasClickAction()).performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("Write the docs")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasText("Run the build")).assertExists()
        for (chip in listOf(R.string.live_agents_chip_all, R.string.live_agents_chip_needs_you, R.string.live_agents_chip_working, R.string.live_agents_chip_failed, R.string.live_agents_chip_finished)) {
            compose.onNode(hasText(res.getString(chip), substring = true) and hasClickAction()).assertExists()
        }
    }
}
