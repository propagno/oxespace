package com.oxespace.mobile.ui.live

import org.junit.Assert.assertEquals
import org.junit.Test

/** Glossary §6 and #354: the four words, the shell colours mapped as the desktop's riskFromShell, anything else critical. */
class RiskLevelTest {
    @Test
    fun theFourWordsReadAsThemselves() {
        assertEquals(listOf(RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL), listOf("low", "medium", "high", "critical").map(::riskLevel))
    }

    @Test
    fun shellColoursMapAsOnTheDesktopSoRedIsNeverSofterThanCritical() {
        assertEquals(listOf(RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.CRITICAL), listOf("green", "orange", "red").map(::riskLevel))
    }

    @Test
    fun aLevelAddedLaterReadsAsCritical() {
        assertEquals(RiskLevel.CRITICAL, riskLevel("catastrophic"))
        assertEquals(RiskLevel.CRITICAL, riskLevel(""))
        assertEquals(RiskLevel.CRITICAL, riskLevel("LOW"))
    }
}
