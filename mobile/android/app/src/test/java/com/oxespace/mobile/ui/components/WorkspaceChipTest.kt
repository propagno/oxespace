package com.oxespace.mobile.ui.components

import com.oxespace.mobile.ui.theme.DarkOxeColors
import com.oxespace.mobile.ui.theme.LightOxeColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A42/A67 (OXE program, phase F10). Written by the planner; the executor must not edit
 * it. CCRs: docs/roadmap-1.5/ccr-phone-screens.md (#688) T-P1.6 and ccr-a67-workspace-color.md (#693): the chip shows
 * the desktop's slot through the generated `wsN` / `wsNFg` tokens, and anything else is the neutral chip.
 */
class WorkspaceChipTest {
    @Test
    fun theEightSlotsMapToTheirTokensInBothThemes() {
        for (colors in listOf(LightOxeColors, DarkOxeColors)) {
            val expected = listOf(
                colors.ws1 to colors.ws1Fg, colors.ws2 to colors.ws2Fg, colors.ws3 to colors.ws3Fg, colors.ws4 to colors.ws4Fg,
                colors.ws5 to colors.ws5Fg, colors.ws6 to colors.ws6Fg, colors.ws7 to colors.ws7Fg, colors.ws8 to colors.ws8Fg,
            )
            for (slot in 1..8) {
                val chip = workspaceChipColors(slot, colors)
                assertEquals("slot $slot", expected[slot - 1], chip?.let { it.background to it.content })
            }
        }
    }

    @Test
    fun absentOrOutOfRangeIsTheNeutralChip() {
        // An older desktop sends no colour; a newer one could send a slot this app doesn't know.
        for (value in listOf(null, 0, 9, -1, Int.MAX_VALUE)) {
            assertNull("$value", workspaceChipColors(value, LightOxeColors))
            assertNull("$value", workspaceChipColors(value, DarkOxeColors))
        }
    }
}
