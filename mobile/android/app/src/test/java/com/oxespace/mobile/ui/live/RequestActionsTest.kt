package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.RemotePendingRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A44 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-phone-screens.md (#688) T-P1.5: the actions a request gets on the redesigned Request screen.
 * [requestActions] is what the screen draws; RequestResponder still checks the same rules before anything is sent.
 */
class RequestActionsTest {
    private val request = RemotePendingRequest(
        threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = "r-1", generation = 4,
        kind = "approval", title = "Run npm test", command = "npm test", decisions = listOf("accept", "decline", "cancel"),
        answerable = true, createdAt = 1,
    )

    private fun decisions(actions: List<RequestAction>) = actions.map { it.decision }

    @Test
    fun aTruncatedRequestOffersOnlyDeny() {
        val actions = requestActions(request.copy(truncated = true), elapsedMs = 60_000)
        assertEquals(listOf("decline"), decisions(actions))
        assertTrue(actions.single().enabled)
        // A truncated question can't be answered on the phone at all.
        assertEquals(emptyList<String>(), decisions(requestActions(request.copy(kind = "question", decisions = emptyList(), truncated = true), elapsedMs = 0)))
    }

    @Test
    fun aRequestOnlyTheDesktopCanAnswerOffersNone() {
        assertEquals(emptyList<RequestAction>(), requestActions(request.copy(answerable = false), elapsedMs = 60_000))
        assertEquals(emptyList<RequestAction>(), requestActions(request.copy(answerable = false, truncated = true), elapsedMs = 60_000))
    }

    @Test
    fun criticalAllowIsEnabledOnlyAfterTwoSeconds() {
        val critical = request.copy(risk = "critical")
        val early = requestActions(critical, elapsedMs = 1_999)
        assertEquals(false, early.single { it.decision == "accept" }.enabled)
        assertEquals(true, early.single { it.decision == "decline" }.enabled)
        assertEquals(true, requestActions(critical, elapsedMs = 2_000).single { it.decision == "accept" }.enabled)
        // Other risks: at once.
        assertEquals(true, requestActions(request.copy(risk = "high"), elapsedMs = 0).single { it.decision == "accept" }.enabled)
    }

    @Test
    fun theOrderAndTheDecisionsAreTheOnesTheDesktopOfferedAsDecisionLayoutLaysThemOut() {
        for (risk in listOf("low", "medium", "high", "critical", null)) {
            val shown = decisions(requestActions(request.copy(risk = risk), elapsedMs = 60_000))
            assertEquals("$risk", decisionLayout(request.decisions, risk).map { it.first }, shown)
        }
        // Never acceptForSession, even if offered.
        assertTrue("acceptForSession" !in decisions(requestActions(request.copy(decisions = request.decisions + "acceptForSession"), elapsedMs = 60_000)))
    }
}
