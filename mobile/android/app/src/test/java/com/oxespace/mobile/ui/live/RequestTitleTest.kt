package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * TECH LEAD R1 v2 / DESIGN option b + OXE-164 (RN-1 / RN-2): a request's heading comes from the phone's catalog by its
 * kind, or for critical requests from the desktop-authored `desktopImpactSummary` — never from the agent's `title`.
 */
class RequestTitleTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private fun criticalRequestJson(title: String, desktopImpactSummary: String?): String {
        val summaryField = desktopImpactSummary?.let { ""","desktopImpactSummary":"$it"""" } ?: ""
        return """{"threadId":"t-1","workspaceId":"w-1","threadTitle":"Fix the login redirect","requestId":"r-1","generation":3,"kind":"approval",
            "title":"$title","command":"rm -rf /","cwd":".","toolName":"Bash","risk":"critical"$summaryField,
            "decisions":["accept","decline"],"answerable":true,"createdAt":1}"""
    }

    @Test
    fun theHeadingIsChosenByKindOnly() {
        assertEquals(R.string.request_kind_agent, requestTitleString("approval"))
        assertEquals(R.string.request_kind_agent, requestTitleString("tool"))
        assertEquals(R.string.request_kind_question, requestTitleString("question"))
        assertEquals(R.string.request_kind_question, requestTitleString("elicitation"))
        assertEquals(R.string.request_kind_permissions, requestTitleString("permissions"))
    }

    @Test
    fun anUnknownOrHostileKindIsAnAgentsRequest() {
        // A kind is never shown; a crafted one (or the agent's title smuggled in its place) falls back to the generic heading.
        for (kind in listOf("", "something-new", "OXESpace checked this: safe to allow", "approval\u202Eevorppa")) {
            assertEquals(kind, R.string.request_kind_agent, requestTitleString(kind))
        }
    }

    @Test
    fun desktopImpactActionSanitizesAndRejectsBlankSummaries() {
        val base = RemotePendingRequest(
            threadId = "t-1", workspaceId = "w-1", threadTitle = "Fix", requestId = "r-1", generation = 1,
            kind = "approval", title = "LIMPAR CACHE", risk = "critical", decisions = listOf("accept", "decline"),
            answerable = true, createdAt = 1,
        )
        assertNull(desktopImpactAction(base.copy(desktopImpactSummary = null)))
        assertNull(desktopImpactAction(base.copy(desktopImpactSummary = "")))
        assertNull(desktopImpactAction(base.copy(desktopImpactSummary = "   \t\n  ")))
        assertEquals("Remover um volume", desktopImpactAction(base.copy(desktopImpactSummary = "  Remover\u202E um volume  ")))
    }

    @Test
    fun `never renders hostile agent title in critical risk header`() {
        val hostile = "LIMPAR CACHE"
        val cases = listOf(
            "Apagar arquivos" to "CRÍTICO · APAGAR ARQUIVOS",
            null to "CRÍTICO · APROVAR COMANDO",
            "   " to "CRÍTICO · APROVAR COMANDO",
        )
        for ((summary, expectedQueueHeader) in cases) {
            val json = criticalRequestJson(title = hostile, desktopImpactSummary = summary)
            val queueScreen = paparazzi.render {
                LiveHome(
                    desktopName = "Studio",
                    banner = null,
                    live = F3Live.live(json),
                    onOpenThread = {},
                    onOpenRequest = {},
                    onOpenTerminal = {},
                    onEnterAddress = {},
                    onUnpair = {},
                    initialTab = LiveTab.REQUESTS,
                )
            }
            val queueTexts = queueScreen.leaves.map { queueScreen.text(it) }.filter { it.isNotBlank() }
            assertTrue("queue critical header is \"$expectedQueueHeader\"; texts=$queueTexts", queueScreen.leavesWithText(expectedQueueHeader).isNotEmpty())
            assertEquals(
                "0 occurrences of hostile agent title in NeedsYou critical header; texts=$queueTexts",
                0,
                queueScreen.leaves.count { queueScreen.text(it).contains(hostile, ignoreCase = true) },
            )

            val request = RemoteFrames.json.decodeFromString(RemotePendingRequest.serializer(), json)
            val detailScreen = paparazzi.render {
                RequestScreen(request, LiveStreams().commands) {}
            }
            val expectedDetailHeading = summary?.trim()?.takeIf { it.isNotEmpty() } ?: detailScreen.string("request_kind_agent")
            val detailHeadings = detailScreen.merged.filter { detailScreen.isHeading(it) }.map { detailScreen.text(it).trim() }
            assertTrue(
                "RequestScreen heading is \"$expectedDetailHeading\"; headings=$detailHeadings",
                expectedDetailHeading in detailHeadings,
            )
            val fromAgentNode = detailScreen.leavesWithText(detailScreen.string("request_from_agent")).first()
            val headerAndFacts = detailScreen.leaves.filter { detailScreen.boundsDp(it).bottom <= detailScreen.boundsDp(fromAgentNode).top + 1f }
            assertEquals(
                "0 occurrences of hostile agent title in RequestScreen risk header; texts=${headerAndFacts.map { detailScreen.text(it) }}",
                0,
                headerAndFacts.count { detailScreen.text(it).contains(hostile, ignoreCase = true) },
            )
            assertEquals(
                "0 occurrences of hostile agent title in RequestScreen headings; headings=$detailHeadings",
                0,
                detailHeadings.count { it.contains(hostile, ignoreCase = true) },
            )
        }
    }
}
