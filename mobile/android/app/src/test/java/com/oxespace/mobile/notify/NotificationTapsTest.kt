package com.oxespace.mobile.notify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationTapsTest {
    private val token = NotificationTaps.currentToken

    @Test
    fun opensWhatTheAppsOwnNotificationNamed() {
        assertEquals(TapTarget("t-1", "r-1"), NotificationTaps.target(token, "t-1", "r-1"))
        assertEquals(TapTarget("t-1", null), NotificationTaps.target(token, "t-1", null))
        assertEquals(TapTarget("t-1", null), NotificationTaps.target(token, "t-1", ""))
    }

    @Test
    fun ignoresAnIntentFromAnotherApp() {
        assertNull("no token", NotificationTaps.target(null, "t-1", "r-1"))
        assertNull("a guessed token", NotificationTaps.target("A".repeat(token.length), "t-1", "r-1"))
        assertNull("the token cut short", NotificationTaps.target(token.dropLast(1), "t-1", "r-1"))
        assertNull("no conversation", NotificationTaps.target(token, null, "r-1"))
        assertNull("an empty conversation", NotificationTaps.target(token, "", null))
    }
}
