package com.oxespace.mobile.protocol.session

import kotlin.random.Random

/**
 * Waits between reconnection attempts: doubling from [baseMs] up to [maxMs], each drawn at random between half the
 * step and the whole step, so many phones that lost the same desktop don't knock on its door at the same instant.
 */
class Backoff(
    private val baseMs: Long = 1_000,
    private val maxMs: Long = 60_000,
    private val random: Random = Random.Default,
) {
    init {
        require(baseMs > 0 && maxMs >= baseMs)
    }

    /** The wait before attempt [attempt] (1 for the first retry). */
    fun delayMs(attempt: Int): Long {
        val step = if (attempt <= 1) baseMs else (baseMs shl (attempt - 1).coerceAtMost(30)).coerceIn(baseMs, maxMs)
        return step / 2 + random.nextLong(step - step / 2 + 1)
    }
}
