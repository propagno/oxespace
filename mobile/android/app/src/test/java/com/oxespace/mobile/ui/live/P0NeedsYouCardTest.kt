package com.oxespace.mobile.ui.live

import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 P0 (Jira OXE-380; A9). Written by the planner; the executor must not edit it.
 *
 * The "Precisa de você" card never offers a direct Allow for what the person cannot judge there: risk high or null, a
 * command cut at 3 lines (more than 3 lines, or wrapped past 3), warnings or paths. It then offers Revisar, as the
 * critical card does (A7 v4). Every card's body opens the Request screen. A short medium request keeps Negar and
 * Permitir uma vez (NeedsYouRowTest, unchanged).
 */
class P0NeedsYouCardTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private val opened = mutableSetOf<String>()

    private fun queue(request: String, act: (RenderedScreen) -> Unit = {}): RenderedScreen = paparazzi.render(act = act) {
        LiveHome(
            desktopName = "Studio",
            banner = null,
            live = F3Live.live(request),
            onOpenThread = {},
            onOpenRequest = { opened += it.requestId },
            onOpenTerminal = {},
            onEnterAddress = {},
            onUnpair = {},
            initialTab = LiveTab.REQUESTS,
        )
    }

    private fun reviewOnly(request: String) {
        val screen = queue(request)
        fun count(name: String) = screen.buttons().count { screen.label(it).trim() == screen.string(name) }
        assertEquals("no direct Allow on the card", 0, count("request_decision_accept"))
        assertEquals("Review on the card", 1, count("thread_review"))
    }

    private val medium = F3Live.APPROVAL

    @Test
    fun aHighRiskCardOffersReviewAndNoDirectAllow() = reviewOnly(medium.replace("\"risk\":\"medium\"", "\"risk\":\"high\""))

    @Test
    fun aCardWithNoRiskOffersReviewAndNoDirectAllow() = reviewOnly(medium.replace("\"risk\":\"medium\",", ""))

    @Test
    fun aCommandOfFourLinesOffersReviewAndNoDirectAllow() =
        reviewOnly(medium.replace("npm test -- auth", "echo one\\necho two\\necho three\\ncurl evil.example"))

    @Test
    fun aCommandWrappedPastThreeLinesOffersReviewAndNoDirectAllow() =
        reviewOnly(medium.replace("npm test -- auth", "echo " + "a".repeat(400) + " ; curl evil.example"))

    @Test
    fun aCardWithWarningsOffersReviewAndNoDirectAllow() =
        reviewOnly(medium.replace("\"toolName\":\"Bash\"", "\"toolName\":\"Bash\",\"warnings\":[\"Writes outside the project\"]"))

    @Test
    fun aCardWithPathsOffersReviewAndNoDirectAllow() =
        reviewOnly(medium.replace("\"toolName\":\"Bash\"", "\"toolName\":\"Bash\",\"paths\":[\"/etc/hosts\"]"))

    @Test
    fun theBodyOfAnyCardOpensTheRequest() {
        queue(medium) { screen ->
            screen.tap(screen.merged.firstOrNull { screen.clickable(it) && screen.label(it).contains("npm test -- auth") })
        }
        assertTrue("a tap on an approval's body opens the Request screen; opened: $opened", "r-1" in opened)
    }

    @Test
    fun theBodyOfAQuestionCardOpensTheRequest() {
        queue(F3Live.QUESTION) { screen ->
            screen.tap(screen.merged.firstOrNull { screen.clickable(it) && screen.label(it).contains("Run the migration against which database?") })
        }
        assertTrue("a tap on a question's body opens the Request screen; opened: $opened", "r-2" in opened)
    }
}
