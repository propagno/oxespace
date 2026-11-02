package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.RemoteThreadItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** M10 §2 and §3a: one card per turn, steps as rows, consecutive steps folded, finished turns collapsed. */
class TimelineTest {
    private fun prompt(id: String) = RemoteThreadItem.Message(id = id, role = "user", text = "do it")
    private fun say(id: String, text: String = "ok") = RemoteThreadItem.Message(id = id, role = "assistant", text = text)
    private fun tool(id: String, name: String, state: String = "completed") = RemoteThreadItem.Tool(id = id, name = name, state = state, detail = "x")
    private fun done(id: String, status: String = "completed") = RemoteThreadItem.Completed(id = id, status = status)
    private fun shape(rows: List<TimelineRow>) = rows.map { it::class.simpleName + ":" + it.key.substringAfter(':') }

    private val finished = listOf(
        prompt("p1"), tool("r1", "Read"), tool("r2", "Read"), tool("b1", "Bash"), say("m1", "looking"), tool("e1", "Edit"), say("m2", "fixed"), done("c1"),
    )

    @Test
    fun aFinishedTurnIsCollapsedToItsBarAndItsLastMessageIsTheOneCard() {
        assertEquals(listOf("Prompt:p1", "TurnBar:p1", "Prose:m1", "Answer:m2"), shape(timelineRows(finished, running = false, openTurns = emptySet())))
    }

    @Test
    fun openingTheBarShowsTheStepsWithReadsAndCommandsFoldedAndEditsAlone() {
        assertEquals(
            listOf("Prompt:p1", "TurnBar:p1", "StepGroup:r1", "Prose:m1", "Step:e1", "Answer:m2"),
            shape(timelineRows(finished, running = false, openTurns = setOf("p1"))),
        )
        val group = timelineRows(finished, running = false, openTurns = setOf("p1")).filterIsInstance<TimelineRow.StepGroup>().single()
        assertEquals(mapOf(StepKind.READ to 2, StepKind.RUN to 1), groupCounts(group.tools))
    }

    @Test
    fun theRunningTurnShowsItsStepsAndTheRunningOneOnlyInTheLiveRow() {
        val running = listOf(prompt("p1"), tool("r1", "Read"), tool("r2", "Grep"), tool("b1", "Bash", state = "running"))
        val rows = timelineRows(running, running = true, openTurns = emptySet())
        assertEquals(listOf("Prompt:p1", "StepGroup:r1", "Running:p1"), shape(rows))
        val live = rows.last() as TimelineRow.Running
        assertEquals(3, live.steps)
        assertEquals("b1", live.current?.id)
    }

    @Test
    fun aWorkingTurnHasNoCardYetAndARequestLeavesAMarker() {
        val items = listOf(prompt("p1"), say("m1"), RemoteThreadItem.Request(id = "q1", requestId = "r-1", kind = "approval", title = "Delete", state = "pending"))
        assertEquals(listOf("Prompt:p1", "Prose:m1", "RequestMarker:q1", "Running:p1"), shape(timelineRows(items, running = true, openTurns = emptySet())))
    }

    @Test
    fun earlierTurnsStayCollapsedWhileTheLastOneRuns() {
        val items = finished + listOf(prompt("p2"), tool("r9", "Read", state = "running"))
        val rows = shape(timelineRows(items, running = true, openTurns = emptySet()))
        assertEquals(listOf("Prompt:p1", "TurnBar:p1", "Prose:m1", "Answer:m2", "Prompt:p2", "Running:p2"), rows)
    }

    @Test
    fun aTurnWithoutStepsHasNoBarAndReasoningIsNotDrawn() {
        val items = listOf(prompt("p1"), RemoteThreadItem.Reasoning(id = "t1", text = "hmm", completed = true), say("m1", "hi"), done("c1"))
        assertEquals(listOf("Prompt:p1", "Answer:m1"), shape(timelineRows(items, running = false, openTurns = emptySet())))
    }

    @Test
    fun toolNamesMapToTheirVerbs() {
        assertEquals(StepKind.READ, stepKind("Read"))
        assertEquals(StepKind.RUN, stepKind("Bash"))
        assertEquals(StepKind.EDIT, stepKind("MultiEdit"))
        assertEquals(StepKind.CREATE, stepKind("Write"))
        assertEquals(StepKind.SEARCH, stepKind("Grep"))
        assertTrue(stepKind("mcp__oxespace__thing") == StepKind.OTHER)
    }
}
