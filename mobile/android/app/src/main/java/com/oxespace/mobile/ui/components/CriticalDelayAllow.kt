@file:Suppress("UNUSED_PARAMETER", "unused")

package com.oxespace.mobile.ui.components

/*
 * 1.5.0 F10 API skeleton (A44), no behaviour; MOB-A44 replaces the TODO. Test: CriticalDelayAllowTest.
 */

/** What the CriticalDelayAllow button draws: enabled or not, and the ring's progress from 0 to 1. */
data class CriticalAllowState(val enabled: Boolean, val progress: Float)

/** Allow on a request the phone reads as critical waits the desktop's 2 s hold; every other level is enabled at once. */
fun criticalAllowState(risk: String?, elapsedMs: Long): CriticalAllowState = TODO("F10 A44")
