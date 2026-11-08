package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemotePendingRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/**
 * Frozen acceptance test for 1.5.0 A44 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * DESIGN, F7 high vs critical on the phone (TECH LEAD, from HML-F7-1):
 * - critical is unchanged: the Critical chip and Allow held 2 s (CriticalDelayAllowTest);
 * - high, irreversible: the High chip and the line "No undo." / "Sem desfazer.", with Allow enabled at once;
 * - a DB write, high or critical, is answered on the computer (`answerable: false`, RequestActionsTest), so this line
 *   only ever shows on a high request the phone may answer.
 */
class RequestRiskNoteTest {
    private val request = RemotePendingRequest(
        threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = "r-1", generation = 1,
        kind = "approval", title = "Force-push main", command = "git push --force", decisions = listOf("accept", "decline"),
        answerable = true, createdAt = 1,
    )
    private val english = File("src/main/res/values/strings.xml")
    private val portuguese = File("src/main/res/values-pt-rBR/strings.xml")

    private fun nameOf(id: Int): String = R.string::class.java.fields.first { it.getInt(null) == id }.name
    private fun strings(file: File): Map<String, String> =
        Regex("""<string name="([a-z0-9_]+)">([^<]*)</string>""").findAll(file.readText()).associate { it.groupValues[1] to it.groupValues[2] }

    @Test
    fun aHighRequestSaysThereIsNoUndo() {
        assertEquals(R.string.request_no_undo, riskNote(request.copy(risk = "high")))
    }

    @Test
    fun everyOtherLevelHasNoNoteCriticalIncluded() {
        for (risk in listOf(null, "low", "medium", "critical", "green", "orange", "red", "unknown-new-level")) {
            assertNull("$risk", riskNote(request.copy(risk = risk)))
        }
    }

    @Test
    fun theNoteIsWordedInBothLanguages() {
        val key = nameOf(R.string.request_no_undo)
        assertEquals("No undo.", strings(english)[key])
        assertEquals("Sem desfazer.", strings(portuguese)[key])
    }
}
