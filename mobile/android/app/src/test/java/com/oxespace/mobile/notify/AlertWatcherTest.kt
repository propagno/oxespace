package com.oxespace.mobile.notify

import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteThreadSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertWatcherTest {
    private fun request(id: String) = RemotePendingRequest(
        threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = id, generation = 1,
        kind = "approval", title = "Run $id", decisions = listOf("accept", "decline"), answerable = true, createdAt = 1,
    )

    private fun thread(status: String, last: String? = null) =
        RemoteThreadSummary(id = "t-1", workspaceId = "w", title = "Fix login", provider = "claude", status = status, lastTurnStatus = last, pendingRequests = 0, updatedAt = 1)

    @Test
    fun announcesEachRequestOnceAndTakesItDownWhenAnswered() {
        val watcher = AlertWatcher()
        val first = watcher.onRequests(listOf(request("r1")))
        assertEquals(
            listOf(AlertChange.Post("request:t-1/r1", AlertKind.NEEDS_YOU, "Run r1", "Fix login", AlertTarget.Request("t-1", "r1"))),
            first,
        )
        // The same list again (a reconnection, the phone waking from Doze) announces nothing new.
        assertTrue(watcher.onRequests(listOf(request("r1"))).isEmpty())
        val next = watcher.onRequests(listOf(request("r2")))
        assertEquals(listOf("request:t-1/r2"), next.filterIsInstance<AlertChange.Post>().map { it.key })
        assertEquals(listOf(AlertChange.Cancel("request:t-1/r1")), next.filterIsInstance<AlertChange.Cancel>())
    }

    @Test
    fun desktopTextReachesTheNotificationWithoutHiddenOrReorderingCharacters() {
        val hostile = request("r1").copy(title = "Open report‮exe.txt‬", threadTitle = "Fix​ login⁦" + "x".repeat(300))
        val post = AlertWatcher().onRequests(listOf(hostile)).single() as AlertChange.Post
        assertEquals("Open reportexe.txt", post.title)
        assertTrue(post.text.startsWith("Fix loginxxx"))
        assertEquals(120, post.text.codePointCount(0, post.text.length))
    }

    @Test
    fun aRequestThatArrivedWhileAsleepIsAnnouncedWhenTheListComesBack() {
        val watcher = AlertWatcher()
        watcher.onRequests(emptyList())
        // Doze: no frames for a while; on waking the snapshot carries what came meanwhile.
        assertEquals(1, watcher.onRequests(listOf(request("r9"))).size)
    }

    @Test
    fun tellsWhenATurnFinishesOrFailsButNotOnTheFirstSighting() {
        val watcher = AlertWatcher()
        assertTrue("baseline", watcher.onThreads(listOf(thread("idle", "completed"))).filterIsInstance<AlertChange.Post>().isEmpty())
        watcher.onThreads(listOf(thread("running")))
        assertEquals(AlertKind.DONE, (watcher.onThreads(listOf(thread("idle", "completed"))).single() as AlertChange.Post).kind)
        watcher.onThreads(listOf(thread("running")))
        assertEquals(AlertKind.FAILED, (watcher.onThreads(listOf(thread("failed", "failed"))).single() as AlertChange.Post).kind)
        assertEquals("working again takes the old one down", listOf(AlertChange.Cancel("thread:t-1")), watcher.onThreads(listOf(thread("running"))))
        assertTrue("waiting for the person isn't done", watcher.onThreads(listOf(thread("approval"))).isEmpty())
    }
}
