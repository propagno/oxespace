package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrames
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ListStoresTest {
    private fun json(text: String) = RemoteFrames.json.parseToJsonElement(text)
    private fun thread(id: String, updatedAt: Long, status: String = "idle") =
        """{"id":"$id","workspaceId":"w","title":"T $id","provider":"codex","status":"$status","pendingRequests":0,"updatedAt":$updatedAt}"""

    @Test
    fun keepsConversationsNewestFirstThroughUpsertsAndRemovals() {
        val store = ThreadsStore()
        store.onSnapshot(listOf(json("""{"threads":[${thread("a", 1)},${thread("b", 3)}]}"""), json("""{"threads":[${thread("c", 2)}]}""")))
        assertEquals(listOf("b", "c", "a"), store.threads.value.map { it.id })
        store.onEvent(json("""{"upsert":[${thread("a", 9, "running")}],"removed":["c"]}"""))
        assertEquals(listOf("a", "b"), store.threads.value.map { it.id })
        assertEquals("running", store.threads.value.first().status)
    }

    @Test
    fun aWholeListStreamTakesTheLatestListAndIgnoresAFrameThatDoesNotFit() {
        val store = pendingRequestsStore()
        val request = """{"threadId":"t","workspaceId":"w","threadTitle":"T","requestId":"r1","generation":2,"kind":"approval","title":"Run npm test","decisions":["accept","decline"],"answerable":true,"createdAt":1}"""
        store.onSnapshot(listOf(json("""{"requests":[$request]}""")))
        assertEquals(listOf("r1"), store.items.value.map { it.requestId })
        store.onEvent(json("""{"requests":"broken"}"""))
        assertEquals("a bad frame leaves the list as it was", listOf("r1"), store.items.value.map { it.requestId })
        store.onEvent(json("""{"requests":[]}"""))
        assertEquals(emptyList<String>(), store.items.value.map { it.requestId })
    }

    @Test
    fun readsWorkspacesWithTheirPanesAndThePhoneWriteFlag() {
        val store = workspacesStore()
        store.onSnapshot(listOf(json("""{"workspaces":[{"id":"w","name":"oxespace","active":true,"panes":[{"id":"p1","title":"zsh","kind":"terminal","phoneWrite":false},{"id":"p2","title":"claude","kind":"agent","agent":"claude","agentState":"working","phoneWrite":true}]}]}""")))
        val panes = store.items.value.single().panes
        assertFalse(panes[0].phoneWrite)
        assertEquals("working", panes[1].agentState)
    }
}
