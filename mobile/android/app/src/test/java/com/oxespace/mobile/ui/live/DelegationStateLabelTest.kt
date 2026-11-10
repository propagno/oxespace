package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Frozen acceptance test for 1.5.0 A42 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * MOBILE's F2 audit G8: the Tasks tab showed a delegation's `state` as the raw wire word ("preparing"), untranslated in
 * pt-BR, and after R13 more tasks arrive as delegations. Every state the desktop can send gets its own words, in
 * English and in Portuguese; an unknown one gets a generic label, never the wire word.
 *
 * The states are read from the desktop's own type (shared/types/delegation.ts), so a state added there fails here
 * until the phone words it. The words are read from the generated string files (npm run android:generate).
 */
class DelegationStateLabelTest {
    /** Gradle runs unit tests from the module directory (`mobile/android/app`). */
    private val repo = File("../../..")
    private val english = File("src/main/res/values/strings.xml")
    private val portuguese = File("src/main/res/values-pt-rBR/strings.xml")

    private fun desktopStates(): List<String> {
        val source = File(repo, "shared/types/delegation.ts").readText()
        val union = Regex("""export type DelegationState\s*=\s*([^\n]+)""").find(source)?.groupValues?.get(1)
            ?: error("DelegationState not found in shared/types/delegation.ts")
        return Regex("""'([a-z-]+)'""").findAll(union).map { it.groupValues[1] }.toList()
    }

    /** The resource name of a string id, from the generated R class. */
    private fun nameOf(id: Int): String = R.string::class.java.fields.first { it.getInt(null) == id }.name
    private val unknownKey get() = nameOf(R.string.live_delegation_state_unknown)

    private fun strings(file: File): Map<String, String> =
        Regex("""<string name="([a-z0-9_]+)">([^<]*)</string>""").findAll(file.readText()).associate { it.groupValues[1] to it.groupValues[2] }

    @Test
    fun theDesktopStatesAreFound() {
        val states = desktopStates()
        assertTrue(states.toString(), states.size >= 9)
        assertTrue(states.containsAll(listOf("preparing", "accepted", "blocked", "failed", "approved", "cancelled")))
    }

    @Test
    fun everyStateTheDesktopSendsHasItsOwnWordsInEnglishAndPortuguese() {
        val en = strings(english)
        val pt = strings(portuguese)
        val keys = mutableSetOf<String>()
        for (state in desktopStates()) {
            val key = nameOf(delegationStateLabel(state))
            assertNotEquals(state, unknownKey, key)
            keys += key
            val enText = en[key] ?: error("$key missing in values/strings.xml")
            val ptText = pt[key] ?: error("$key missing in values-pt-rBR/strings.xml")
            assertTrue(state, enText.isNotBlank() && ptText.isNotBlank())
            assertNotEquals("$state: pt-BR is not the English", enText, ptText)
        }
        assertEquals("each state has its own label", desktopStates().size, keys.size)
    }

    @Test
    fun aStateThisAppDoesNotKnowGetsTheGenericLabelNeverTheWireWord() {
        assertEquals(R.string.live_delegation_state_unknown, delegationStateLabel("something-new"))
        assertTrue(strings(english)[unknownKey].orEmpty().isNotBlank())
        assertTrue(strings(portuguese)[unknownKey].orEmpty().isNotBlank())
    }
}
