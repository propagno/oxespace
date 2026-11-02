package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteThreadItem
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveStoresTest {
    private fun json(text: String): JsonElement = RemoteFrames.json.parseToJsonElement(text)

    private val header = """{"id":"t-1","workspaceId":"w","title":"Fix login","provider":"claude","status":"running","pendingRequests":0,"updatedAt":1,"queued":0,"canSteer":true}"""

    private fun message(seq: Int, id: String, text: String) =
        """{"seq":$seq,"item":{"type":"message","id":"$id","role":"assistant","text":"$text"}}"""

    @Test
    fun buildsTheTimelineFromPagedSnapshotAndGrowsMessagesInPlace() {
        val timeline = ThreadTimeline()
        timeline.onSnapshot(listOf(
            json("""{"thread":$header,"items":[${message(1, "m1", "Hi")}],"hasMore":true}"""),
            json("""{"thread":$header,"items":[${message(2, "m2", "Look")}],"hasMore":true}"""),
        ))
        assertEquals(listOf("m1", "m2"), timeline.items.map { it.item.id })
        assertTrue(timeline.hasMore)
        assertEquals("Fix login", timeline.header?.title)

        // The message m2 grew; a tool started after it.
        timeline.onEvent(json("""{"thread":$header,"items":[${message(5, "m2", "Looking at auth.ts")},
            {"seq":6,"item":{"type":"tool","id":"x1","name":"Bash","state":"running","detail":"npm test","redacted":1}}]}"""))
        assertEquals(listOf("m1", "m2", "x1"), timeline.items.map { it.item.id })
        assertEquals("Looking at auth.ts", (timeline.items[1].item as RemoteThreadItem.Message).text)
        assertEquals("keeps the position of its first appearance", 2L, timeline.items[1].seq)
        assertEquals(1L, (timeline.items[2].item as RemoteThreadItem.Tool).redacted)
    }

    @Test
    fun skipsAnItemTypeItDoesNotKnowInsteadOfTheWholeFrame() {
        val timeline = ThreadTimeline()
        timeline.onSnapshot(listOf(json("""{"thread":$header,"items":[${message(1, "m1", "Hi")},
            {"seq":2,"item":{"type":"hologram","id":"h1"}}, ${message(3, "m3", "Bye")}],"hasMore":false}""")))
        assertEquals(listOf("m1", "m3"), timeline.items.map { it.item.id })
        assertEquals(1, timeline.skipped)
    }

    @Test
    fun aSnapshotReplacesEverythingAndOlderPagesGoBefore() {
        val timeline = ThreadTimeline()
        timeline.onSnapshot(listOf(json("""{"thread":$header,"items":[${message(10, "m10", "new")}],"hasMore":true}""")))
        timeline.prepend(json("""{"thread":$header,"items":[${message(4, "m4", "old")}, ${message(10, "m10", "dup")}],"hasMore":false}"""))
        assertEquals(listOf("m4", "m10"), timeline.items.map { it.item.id })
        assertEquals("history never overwrites newer text", "new", (timeline.items[1].item as RemoteThreadItem.Message).text)
        assertFalse(timeline.hasMore)
        timeline.onSnapshot(listOf(json("""{"thread":$header,"items":[${message(20, "m20", "reset")}],"hasMore":false}""")))
        assertEquals(listOf("m20"), timeline.items.map { it.item.id })
    }

    @Test
    fun followsTerminalOutputAndClearsWhenTheRingMovedOn() {
        val terminal = TerminalBuffer(capacity = 20)
        terminal.onSnapshot(listOf(json("""{"data":"$ ls\n","truncated":false}"""), json("""{"data":"a b\n","truncated":false}""")))
        assertEquals("$ ls\na b\n", terminal.output)
        terminal.onEvent(json("""{"data":"TOKEN=[hidden]\n","truncated":false,"redacted":1}"""))
        // Over capacity: whole lines leave from the start.
        assertEquals("a b\nTOKEN=[hidden]\n", terminal.output)
        assertEquals(1L, terminal.redacted)
        terminal.onEvent(json("""{"data":"fresh\n","truncated":true}"""))
        assertEquals("fresh\n", terminal.output)
    }
}
