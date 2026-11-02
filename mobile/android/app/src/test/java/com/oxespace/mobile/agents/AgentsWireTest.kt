package com.oxespace.mobile.agents

import com.oxespace.mobile.protocol.RemoteAgentsEvent
import com.oxespace.mobile.protocol.RemoteAgentsSnapshot
import com.oxespace.mobile.protocol.RemoteFrames
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The C5 `agents` block (#531) as the phone decodes it, through the same Json as every frame. */
class AgentsWireTest {
    private val snapshotJson = """
        {"rows":[
          {"kind":"thread","id":"t-1","rev":10,"state":"needs-you","provider":"claude","title":"Fix login","since":1000,
           "request":{"requestId":"r-1","title":"Run npm test","titleCode":"approvals.title.shell","titleParams":{"command":"npm test"},"risk":"high","answerable":true}},
          {"kind":"pane","id":"p-1","rev":11,"state":"dreaming","provider":"codex","title":"Pane 1","since":2000},
          {"kind":"robot","id":"x","rev":12,"state":"working","provider":"other","title":"From the future","since":3000}
        ],"unavailable":["work","satellites"]}
    """.trimIndent()

    @Test
    fun `an unknown state, kind or source never breaks the snapshot`() {
        val store = AgentsStore()
        store.apply(RemoteFrames.json.decodeFromString(RemoteAgentsSnapshot.serializer(), snapshotJson))
        val rows = store.state.value.rows.associateBy { it.id }
        assertEquals(setOf("t-1", "p-1"), rows.keys)
        assertEquals(AgentState.UNKNOWN, stateOf(rows.getValue("p-1")))
        assertEquals(listOf("work", "satellites"), store.state.value.unavailable)
        val request = rows.getValue("t-1").request!!
        assertEquals("high", request.risk)
        assertEquals(mapOf("command" to "npm test"), request.titleParams)
        assertEquals("approvals.title.shell", request.titleCode)
    }

    @Test
    fun `an event removes by kind, id and rev`() {
        val store = AgentsStore()
        store.apply(RemoteFrames.json.decodeFromString(RemoteAgentsSnapshot.serializer(), snapshotJson))
        store.apply(RemoteFrames.json.decodeFromString(RemoteAgentsEvent.serializer(), """{"removed":[{"kind":"thread","id":"t-1","rev":20}],"unavailable":[]}"""))
        assertEquals(listOf("p-1"), store.state.value.rows.map { it.id })
        assertTrue(store.state.value.unavailable.isEmpty())
    }
}
