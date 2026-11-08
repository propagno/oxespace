package com.oxespace.mobile.ui.components

import com.oxespace.mobile.approval.allowHoldMsFor

/*
 * 1.5.0 F10 A44: Allow on a critical request waits the desktop's hold. Test: CriticalDelayAllowTest.
 */

/** What the CriticalDelayAllow button draws: enabled or not, and the ring's progress from 0 to 1. */
data class CriticalAllowState(val enabled: Boolean, val progress: Float)

/**
 * Allow on a request the phone reads as critical waits the desktop's 2 s hold; every other level is enabled at once.
 * A clock that goes back (a negative elapsed) never enables it early.
 */
fun criticalAllowState(risk: String?, elapsedMs: Long): CriticalAllowState {
    val hold = allowHoldMsFor(risk)
    if (hold <= 0L) return CriticalAllowState(enabled = true, progress = 1f)
    val elapsed = elapsedMs.coerceIn(0L, hold)
    return CriticalAllowState(enabled = elapsedMs >= hold, progress = elapsed.toFloat() / hold.toFloat())
}
