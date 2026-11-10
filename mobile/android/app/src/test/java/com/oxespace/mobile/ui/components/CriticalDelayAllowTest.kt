package com.oxespace.mobile.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A42/A44 (OXE program, phase F10). Written by the planner; the executor must not edit
 * it. CCR: docs/roadmap-1.5/ccr-phone-screens.md (#688) T-P1.2: `CriticalDelayAllow` is disabled until 2 000 ms on a
 * critical request, as the desktop holds it (APPROVAL_CRITICAL_ALLOW_DELAY_MS), and enabled at once on other risks.
 * The component draws [criticalAllowState]; the timing is tested here, the drawing in ComponentsSnapshotTest.
 */
class CriticalDelayAllowTest {
    @Test
    fun onACriticalRequestAllowIsDisabledUntilTwoSeconds() {
        for (elapsed in listOf(0L, 1L, 1_000L, 1_999L)) assertFalse("$elapsed", criticalAllowState("critical", elapsed).enabled)
        for (elapsed in listOf(2_000L, 2_001L, 60_000L)) assertTrue("$elapsed", criticalAllowState("critical", elapsed).enabled)
    }

    @Test
    fun theProgressFillsOverTheHoldAt0And50And100Percent() {
        assertEquals(0f, criticalAllowState("critical", 0).progress, 0f)
        assertEquals(0.5f, criticalAllowState("critical", 1_000).progress, 0.001f)
        assertEquals(1f, criticalAllowState("critical", 2_000).progress, 0f)
        assertEquals(1f, criticalAllowState("critical", 10_000).progress, 0f)
    }

    @Test
    fun onEveryOtherRiskAllowIsEnabledAtOnce() {
        // High is irreversible but has no hold (DESIGN, F7 from HML-F7-1): its sheet says "No undo." instead.
        for (risk in listOf(null, "low", "medium", "high", "green", "orange")) {
            val state = criticalAllowState(risk, 0)
            assertTrue("$risk", state.enabled)
            assertEquals("$risk", 1f, state.progress, 0f)
        }
    }

    @Test
    fun aLevelThePhoneReadsAsCriticalHoldsLikeCritical() {
        // riskLevel reads an older desktop's "red", and a level added later, as critical, the strongest badge (#354).
        // A request badged Critical never gets an Allow without the hold.
        for (risk in listOf("red", "unknown-new-level")) {
            assertFalse("$risk", criticalAllowState(risk, 1_999).enabled)
            assertTrue("$risk", criticalAllowState(risk, 2_000).enabled)
        }
    }

    @Test
    fun aClockThatGoesBackNeverEnablesItEarly() {
        assertFalse(criticalAllowState("critical", -5_000).enabled)
        assertEquals(0f, criticalAllowState("critical", -5_000).progress, 0f)
    }
}
