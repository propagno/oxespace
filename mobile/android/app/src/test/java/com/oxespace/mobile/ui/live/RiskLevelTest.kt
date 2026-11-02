package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.RemoteApprovalRisk
import org.junit.Assert.assertEquals
import org.junit.Test

/** Glossary §6 and #354: the four words, the shell colours mapped as the desktop's riskFromShell, anything else critical. */
class RiskLevelTest {
    @Test
    fun theFourWordsReadAsThemselves() {
        assertEquals(listOf(RemoteApprovalRisk.LOW, RemoteApprovalRisk.MEDIUM, RemoteApprovalRisk.HIGH, RemoteApprovalRisk.CRITICAL), listOf("low", "medium", "high", "critical").map(::riskLevel))
        // Every level the protocol generates (#368) reads as itself, so a fifth one added there can't fall to critical unseen.
        for (risk in RemoteApprovalRisk.entries) assertEquals(risk, riskLevel(risk.wire))
    }

    @Test
    fun shellColoursMapAsOnTheDesktopSoRedIsNeverSofterThanCritical() {
        assertEquals(listOf(RemoteApprovalRisk.LOW, RemoteApprovalRisk.MEDIUM, RemoteApprovalRisk.CRITICAL), listOf("green", "orange", "red").map(::riskLevel))
    }

    @Test
    fun aLevelAddedLaterReadsAsCritical() {
        assertEquals(RemoteApprovalRisk.CRITICAL, riskLevel("catastrophic"))
        assertEquals(RemoteApprovalRisk.CRITICAL, riskLevel(""))
        assertEquals(RemoteApprovalRisk.CRITICAL, riskLevel("LOW"))
    }
}
