package com.oxespace.mobile.protocol.session

import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BackoffTest {
    @Test
    fun doublesUpToTheCeilingAndStaysWithinHalfToWholeOfEachStep() {
        val backoff = Backoff(baseMs = 1_000, maxMs = 60_000, random = Random(7))
        val steps = listOf(1_000L, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000)
        for ((index, step) in steps.withIndex()) {
            repeat(200) {
                val wait = backoff.delayMs(index + 1)
                assertTrue("attempt ${index + 1}: $wait", wait in step / 2..step)
            }
        }
    }

    @Test
    fun spreadsAttemptsSoPhonesDoNotRetryTogether() {
        val backoff = Backoff(random = Random(1))
        val waits = (1..100).map { backoff.delayMs(6) }.toSet()
        assertTrue("jitter gives different waits, got ${waits.size}", waits.size > 50)
    }

    @Test
    fun neverOverflowsOnVeryLongOutages() {
        val backoff = Backoff(baseMs = 1_000, maxMs = 60_000, random = Random(3))
        assertTrue(backoff.delayMs(10_000) in 30_000L..60_000L)
        assertEquals(1_000L, Backoff(baseMs = 1_000, maxMs = 1_000, random = object : Random() {
            override fun nextBits(bitCount: Int) = 0
            override fun nextLong(until: Long) = until - 1
        }).delayMs(1))
    }
}
