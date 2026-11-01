package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * TECH LEAD R1 v2 / DESIGN option b: a request's heading comes from the phone's catalog by its kind, never from the
 * agent's text, however that text is written; a kind this app doesn't know reads as an agent's request.
 */
class RequestTitleTest {
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
}
