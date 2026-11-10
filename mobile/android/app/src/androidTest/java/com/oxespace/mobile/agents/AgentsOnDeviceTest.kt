package com.oxespace.mobile.agents

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.live.FakeDesktop
import com.oxespace.mobile.protocol.RemoteCommand
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.session.LiveRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frozen acceptance test for 1.5.0 A43 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-phone-agents-steer.md (#689) T-P2.1, the emulator test: the app's real `agents` stream,
 * store and command on an Android runtime, against the in-test fake desktop. No fake data in the app: the rows come
 * from the stream.
 */
@RunWith(AndroidJUnit4::class)
class AgentsOnDeviceTest {
    private val desktop = FakeDesktop()

    @After
    fun tearDown() = desktop.close()

    private fun json(text: String): JsonElement = RemoteFrames.json.parseToJsonElement(text)

    private fun row(kind: String, id: String, state: String, rev: Long, title: String) =
        """{"kind":"$kind","id":"$id","rev":$rev,"state":"$state","provider":"claude","title":"$title","since":1000}"""

    private val snapshot = json("""{"rows":[${row("thread", "t-docs", "finished", 1, "Write the docs")},${row("pane", "p-1", "working", 2, "Build")}],"unavailable":[]}""")

    private fun model(): AgentsViewModel {
        desktop.serve(RemoteSubscription.AGENTS) { snapshot }
        val model = AgentsViewModel(LiveRepository(desktop.streams))
        desktop.connect()
        desktop.settle()
        return model
    }

    private fun waitFor(model: AgentsViewModel, done: (AgentsState) -> Boolean): AgentsState =
        runBlocking { withTimeout(10_000) { model.state.first(done) } }

    @Test
    fun theAgentsTabFollowsTheRealTopicASnapshotThenAnUpsert() {
        val model = model()
        assertEquals(1, desktop.subscribes(RemoteSubscription.AGENTS).size)
        val first = waitFor(model) { it.loaded }
        assertEquals(setOf("t-docs", "p-1"), first.rows.map { it.id }.toSet())

        desktop.event(RemoteSubscription.AGENTS, data = json("""{"upsert":[${row("pane", "p-1", "needs-you", 3, "Build")}],"unavailable":[]}"""))
        val after = waitFor(model) { state -> state.rows.any { it.id == "p-1" && it.state == "needs-you" } }
        assertEquals("needs-you", after.rows.single { it.id == "p-1" }.state)
        assertEquals(2, after.rows.size)
    }

    @Test
    fun openingAFinishedRowSendsMarkSeenAndAnyOtherRowSendsNothing() {
        val model = model()
        val loaded = waitFor(model) { it.loaded }

        model.open(loaded.rows.single { it.id == "p-1" })
        desktop.settle()
        assertTrue(desktop.commands(RemoteCommand.AGENT_MARK_SEEN).isEmpty())

        model.open(loaded.rows.single { it.id == "t-docs" })
        runBlocking { withTimeout(10_000) { while (desktop.commands(RemoteCommand.AGENT_MARK_SEEN).isEmpty()) delay(20) } }
        val args = desktop.commands(RemoteCommand.AGENT_MARK_SEEN).single().args
        assertEquals("thread", args["kind"]?.jsonPrimitive?.content)
        assertEquals("t-docs", args["id"]?.jsonPrimitive?.content)
    }

    @Test
    fun aReconnectResubscribesAndTheFreshSnapshotReplacesTheRows() {
        val model = model()
        waitFor(model) { it.loaded }
        // N1 on the device: the session drops and comes back; the desktop has a different list now.
        desktop.streams.detach()
        desktop.serve(RemoteSubscription.AGENTS) { json("""{"rows":[${row("delegation", "d-9", "working", 9, "Plan")}],"unavailable":[]}""") }
        desktop.connect()
        desktop.settle()
        val after = waitFor(model) { state -> state.rows.map { it.id } == listOf("d-9") }
        assertEquals(listOf("d-9"), after.rows.map { it.id })
        assertEquals(2, desktop.subscribes(RemoteSubscription.AGENTS).size)
    }
}
