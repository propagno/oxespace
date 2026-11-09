package com.oxespace.mobile.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeType
import kotlin.math.ceil

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

/**
 * CR-A42b-2 (M5, #627 HANDOFF-MOBILE "CriticalDelayAllow"): Allow at critical risk as a secondary button with a ring that
 * fills over the desktop's hold, then the biometric. A timer, not a press-and-hold (MOB-1-6). [enabled] is the truth
 * (requestActions); the ring only shows the wait. The label stays the decision's own word, so the countdown is a second
 * line: "in 2 s".
 */
@Composable
fun CriticalDelayAllow(label: String, countdown: (Int) -> String, holdMs: Long, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Oxe.colors
    val progress = remember(holdMs) { Animatable(if (holdMs > 0L) 0f else 1f) }
    LaunchedEffect(holdMs) {
        if (holdMs > 0L) progress.animateTo(1f, tween(durationMillis = holdMs.toInt(), easing = LinearEasing))
    }
    val left = ceil((1f - progress.value) * holdMs / 1000f).toInt()
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(OxeRadius.lg),
        colors = ButtonDefaults.buttonColors(
            containerColor = colors.surfaceRaised,
            contentColor = colors.textPrimary,
            disabledContainerColor = colors.surfaceSunken,
            disabledContentColor = colors.textDisabled,
        ),
        border = BorderStroke(1.dp, if (enabled) colors.borderDefault else colors.borderSubtle),
        contentPadding = PaddingValues(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
    ) {
        if (!enabled) {
            val ring = colors.accent
            val track = colors.borderDefault
            Canvas(Modifier.size(18.dp)) {
                val stroke = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round)
                drawArc(track, 0f, 360f, useCenter = false, style = stroke)
                drawArc(ring, -90f, 360f * progress.value, useCenter = false, style = stroke)
            }
            Spacer(Modifier.width(OxeSpace.space2))
        }
        Text(label, style = MaterialTheme.typography.labelLarge.copy(fontWeight = OxeType.weightSemibold), maxLines = 1)
        if (!enabled && left > 0) {
            Spacer(Modifier.width(OxeSpace.space1))
            Text(countdown(left), style = MaterialTheme.typography.labelLarge, color = colors.textMuted, maxLines = 1)
        }
    }
}
