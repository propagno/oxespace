package com.oxespace.mobile.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.approval.allowHoldMsFor
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeType
import kotlin.math.ceil
import kotlinx.coroutines.launch

/*
 * 1.5.0 F10 A44: Allow on a critical request waits the desktop's hold. Test: CriticalDelayAllowTest.
 * 1.5.2 A7 (OXE-134 CA-2): after the wait it is a press-and-hold of the desktop's IMPACT_HOLD_MS. Test: NeedsYouRowTest.
 * OXE-383 (part A): TalkBack and Switch Access reach the hold through a long-click action, the completed hold is felt
 * (LongPress haptic), and each request starts over ([requestKey]). Test: CriticalDelayAllowA11yTest.
 */

/** How long Allow on a critical request must be held once the wait is over (the desktop's HoldToApprove). */
const val CRITICAL_ALLOW_PRESS_MS = 1_200L

/** The hold's progress: 0 at 0 or less, linear up to [CRITICAL_ALLOW_PRESS_MS], 1 from then on. */
fun criticalAllowPressProgress(pressedMs: Long): Float = when {
    pressedMs <= 0L -> 0f
    pressedMs >= CRITICAL_ALLOW_PRESS_MS -> 1f
    else -> pressedMs.toFloat() / CRITICAL_ALLOW_PRESS_MS.toFloat()
}

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

/**
 * Allow at critical risk: off for the desktop's wait (the ring fills, "in 2 s"), then a press-and-hold of
 * [CRITICAL_ALLOW_PRESS_MS] with the ring in accent; releasing early cancels. It has no click action, so a tap never
 * allows; its state description says it must be held. Once enabled, an accessibility service's long-click (TalkBack's
 * double-tap-and-hold, Switch Access) is the hold. [enabled] is the truth (requestActions). [requestKey] names the
 * request, so the wait and the hold of the next one start from zero.
 */
@Composable
fun CriticalDelayAllow(
    label: String,
    countdown: @Composable (Int) -> String,
    holdMs: Long,
    enabled: Boolean,
    holdHint: String,
    onHeld: () -> Unit,
    requestKey: String,
    modifier: Modifier = Modifier,
) {
    val colors = Oxe.colors
    val wait = remember(requestKey, holdMs) { Animatable(if (holdMs > 0L) 0f else 1f) }
    LaunchedEffect(requestKey, holdMs) {
        if (holdMs > 0L) wait.animateTo(1f, tween(durationMillis = holdMs.toInt(), easing = LinearEasing))
    }
    val left = ceil((1f - wait.value) * holdMs / 1000f).toInt()
    var pressedMs by remember(requestKey) { mutableLongStateOf(0L) }
    val haptic = LocalHapticFeedback.current
    val onHeldNow by rememberUpdatedState(onHeld)
    val held = {
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        onHeldNow()
    }
    val scope = rememberCoroutineScope()
    val shape = RoundedCornerShape(OxeRadius.lg)
    Row(
        modifier
            .heightIn(min = 48.dp)
            .clip(shape)
            .background(if (enabled) colors.surfaceRaised else colors.surfaceSunken)
            .border(1.dp, if (enabled) colors.borderDefault else colors.borderSubtle, shape)
            .semantics(mergeDescendants = true) {
                role = Role.Button
                stateDescription = holdHint
                if (!enabled) disabled()
                else onLongClick(label = holdHint) { held(); true }
            }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures(onPress = {
                    var done = false
                    val fill = scope.launch {
                        val start = withFrameMillis { it }
                        while (!done) {
                            val now = withFrameMillis { it }
                            pressedMs = now - start
                            if (criticalAllowPressProgress(pressedMs) >= 1f) {
                                done = true
                                held()
                            }
                        }
                    }
                    tryAwaitRelease()
                    if (!done) fill.cancel()
                    pressedMs = 0L
                })
            }
            .padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val ring = colors.accent
        val track = colors.borderDefault
        val progress = if (enabled) criticalAllowPressProgress(pressedMs) else wait.value
        Canvas(Modifier.size(18.dp)) {
            val stroke = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round)
            drawArc(track, 0f, 360f, useCenter = false, style = stroke)
            drawArc(ring, -90f, 360f * progress, useCenter = false, style = stroke)
        }
        Spacer(Modifier.width(OxeSpace.space2))
        Text(
            label,
            style = MaterialTheme.typography.labelLarge.copy(fontWeight = OxeType.weightSemibold),
            color = if (enabled) colors.textPrimary else colors.textDisabled,
            maxLines = 1,
        )
        if (!enabled && left > 0) {
            Spacer(Modifier.width(OxeSpace.space1))
            Text(countdown(left), style = MaterialTheme.typography.labelLarge, color = colors.textMuted, maxLines = 1)
        }
    }
}
