package com.oxespace.mobile.protocol.pairing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 152p1c (phase F1, Jira OXE-382, transport). Written by the planner; the executor must
 * not edit it.
 *
 * - A half-open socket is found within 30 s: the pinned client sends a WebSocket ping every 20 s (OkHttp closes the
 *   socket when a pong does not come back in time). Today no ping is sent and a dead link shows "Connected" for minutes.
 * - Reconnecting does not leak a thread and connection pool per attempt: every pinned client is built from one shared
 *   base (newBuilder), so they share its connection pool and dispatcher; the pin, the hostname check and the timeouts
 *   stay per fingerprint.
 */
class P1cPinnedClientTest {
    private val a = "a".repeat(64)
    private val b = "b".repeat(64)

    @Test
    fun thePinnedClientPingsEvery20Seconds() {
        assertEquals(20_000, PinnedTls.client(a).pingIntervalMillis)
    }

    @Test
    fun pinnedClientsShareOnePoolAndDispatcher() {
        val first = PinnedTls.client(a)
        val second = PinnedTls.client(b, callTimeoutMs = 120_000)
        assertSame("one connection pool for every pinned client", first.connectionPool, second.connectionPool)
        assertSame("one dispatcher (thread pool) for every pinned client", first.dispatcher, second.dispatcher)
        assertEquals("the call timeout stays per client", 120_000, second.callTimeoutMillis)
    }
}
