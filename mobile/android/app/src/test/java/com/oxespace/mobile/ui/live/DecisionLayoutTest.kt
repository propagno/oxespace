package com.oxespace.mobile.ui.live

import org.junit.Assert.assertEquals
import org.junit.Test

/** Audit P1: a hurried tap on anything but a read-only request denies; Allow is never the lead there. */
class DecisionLayoutTest {
    private val offered = listOf("accept", "decline", "cancel")

    @Test
    fun denyLeadsOnRequestsThatChangeOrDeleteSomething() {
        for (risk in listOf("orange", "red", null, "unknown-new-level")) {
            assertEquals(risk.toString(), listOf("decline" to true, "accept" to false, "cancel" to false), decisionLayout(offered, risk))
        }
    }

    @Test
    fun allowLeadsOnlyOnARequestThatOnlyReads() {
        assertEquals(listOf("accept" to true, "decline" to false, "cancel" to false), decisionLayout(offered, "green"))
    }

    @Test
    fun aDecisionThePhoneDoesNotKnowIsNeverDrawnUnderAnotherLabel() {
        // A later "acceptAlways" must not show as an outlined "Cancel" that sends an allow.
        assertEquals(listOf("decline" to true, "cancel" to false), decisionLayout(listOf("acceptAlways", "decline", "cancel"), "red"))
        assertEquals(emptyList<Pair<String, Boolean>>(), decisionLayout(listOf("acceptForSession"), "green"))
    }

    @Test
    fun aDecisionThatWasNotOfferedNeverAppears() {
        assertEquals(listOf("decline" to true), decisionLayout(listOf("decline"), "red"))
        assertEquals(listOf("decline" to false), decisionLayout(listOf("decline"), "green"))
    }
}
