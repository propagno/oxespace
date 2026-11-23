package com.oxespace.mobile.ui.components

import androidx.compose.ui.semantics.Role
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 152p1c (phase F1, Jira OXE-363, the Compose accessibility part). Written by the
 * planner; the executor must not edit it. Read the way TalkBack and the layout see it (RenderedScreen).
 *
 * - Segmented: every option is a touch target of at least 48 dp high (today 42 dp).
 * - PairingStepper: once paired (current = labels.size, every step done), the row still speaks; today it speaks "".
 * (OxeButton's two lines at 200% font scale already landed in 22b265d8f, OXE-373.)
 */
class P1cPairingA11yTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private val steps = listOf("Ler", "Conectar", "Confirmar", "Pronto")

    @Test
    fun everySegmentedOptionIsAt48dpHigh() {
        val screen = paparazzi.render { Segmented(options = listOf("Claro", "Escuro", "Sistema"), selected = 0, onSelect = {}) }
        val tabs = screen.merged.filter { screen.role(it) == Role.Tab }
        assertEquals("three options", 3, tabs.size)
        for (tab in tabs) assertTrue("${screen.describe(tab)} is at least 48 dp high", screen.heightDp(tab) >= 47.5f)
    }

    @Test
    fun theStepperSpeaksOncePaired() {
        val screen = paparazzi.render { PairingStepper(labels = steps, current = steps.size) }
        val spoken = screen.merged.map { screen.label(it) }.filter { it.isNotBlank() }
        assertTrue("the paired stepper says something to TalkBack, got $spoken", spoken.any { it.contains("4/4") || it.contains("Pronto") })
    }

    @Test
    fun theStepperStillSpeaksEachStepBeforePairing() {
        val screen = paparazzi.render { PairingStepper(labels = steps, current = 1) }
        val spoken = screen.merged.map { screen.label(it) }
        assertTrue("step 2 is read as 2/4: Conectar, got $spoken", spoken.any { it.contains("2/4: Conectar") })
    }
}
