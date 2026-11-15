package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.ui.F3Live
import com.oxespace.mobile.ui.PhoneScale
import com.oxespace.mobile.ui.RenderedScreen
import com.oxespace.mobile.ui.Samples
import com.oxespace.mobile.ui.phonePaparazzi
import com.oxespace.mobile.ui.render
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 Celular A12 (OXE program oxespace-152-mobile, phase F3, Jira OXE-19 CA-5 and CA-6).
 * Written by the planner; the executor must not edit it.
 *
 * A tool call in a phone conversation is a compact card, as OxeChat's: one stop for TalkBack that says the tool's name
 * as the agent called it ("Bash"), its state in words (thread_tool_running / _completed / _failed) and its summary (the
 * target: the command, the file), at least 48 dp tall; a tap opens it to its output and diff and closes it again, and
 * its state is said in the locale (new strings thread_step_collapsed / thread_step_expanded, not the English literals
 * "collapsed" / "expanded"). Drawn by the real ThreadScreen. The card lives in the new ui/live/ToolCard.kt (StepRow moves
 * there; StepGroupRow keeps calling StepsSummary in ThreadScreen.kt, which ScreensMatchHandoffTest requires).
 * CA-6: the reference conversation (Samples.reference(): headings, italics, a link, a table, a code block, tool cards,
 * a request) gets a "thread-reference" shot in ScreensSnapshotTest; its goldens come from ci/record-phone-goldens and
 * the parity checklist with OxeChat closes at HML. BRD-07 (OXE-69): nothing under 11 sp, radii only OxeRadius.
 *
 * Red at F3 @ origin/main f417a86f0: a step reads "Executou npm test -- auth" with a "✓" glyph (no tool name, no state
 * word), is 40 dp tall, and says "collapsed" in English on a pt-BR phone.
 */
class ToolCardTest {
    @get:Rule
    val paparazzi = phonePaparazzi()

    private fun working(): RenderedScreen = paparazzi.render {
        val watched = F3Live.conversation(
            running = true, pending = 0,
            """{"type":"message","id":"u1","role":"user","text":"Run the tests and the lint."}""",
            """{"type":"tool","id":"x1","name":"Bash","state":"completed","detail":"npm test -- auth","output":"Tests: 12 passed","exitCode":0}""",
            """{"type":"message","id":"a1","role":"assistant","text":"The tests pass; now the lint."}""",
            """{"type":"tool","id":"x2","name":"Bash","state":"failed","detail":"npm run lint","output":"1 error","exitCode":1}""",
        )
        ThreadScreen("t-1", watched, LiveStreams().commands, Samples.presence, connected = true) {}
    }

    private fun RenderedScreen.card(target: String) = merged.filter { label(it).contains(target) }.let { found ->
        assertEquals("one card for \"$target\"; stops: ${merged.map { label(it) }.filter { it.isNotBlank() }}", 1, found.size)
        found.single()
    }

    @Test
    fun aToolCallIsACompactCardWithItsNameStateAndSummary() {
        val screen = working()
        val done = screen.card("npm test -- auth")
        val said = screen.label(done)
        assertTrue("the card names the tool: \"$said\"", said.contains("Bash"))
        assertTrue("the card says its state in words (\"${screen.string("thread_tool_completed")}\"): \"$said\"", said.contains(screen.string("thread_tool_completed")))
        assertTrue("${screen.describe(done)} is at least 48 dp tall", screen.heightDp(done) >= 47.5f)
        val failed = screen.label(screen.card("npm run lint"))
        assertTrue("a failed call says so: \"$failed\"", failed.contains("Bash") && failed.contains(screen.string("thread_tool_failed")))
    }

    @Test
    fun aTapOpensTheCardAndItsStateIsSaidInTheLocale() {
        val screen = working()
        val done = screen.card("npm test -- auth")
        assertTrue("the card opens on a tap", screen.clickable(done))
        val state = screen.stateDescription(done)
        assertNotEquals("the state is not the English literal on a pt-BR phone", "collapsed", state)
        assertEquals("closed, in the locale", screen.string("thread_step_collapsed"), state)
    }

    @Test
    fun theCardFollowsThePhoneScale() {
        assertEquals("BRD-07 in ToolCard.kt", emptyList<String>(), PhoneScale.offenders("live/ToolCard.kt"))
        val small = working().textSizes().filter { it.second < 11f }
        assertEquals("no text under 11 sp", emptyList<Pair<String, Float>>(), small)
    }
}
