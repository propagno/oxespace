package com.oxespace.mobile.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.agents.AgentState
import com.oxespace.mobile.ui.theme.Oxe

/*
 * 1.5.0 F10 CR-A42. Test: ComponentsSnapshotTest.
 * Design: #627 HANDOFF-MOBILE.md: a 14 dp ring. Needs you (the sun, filled, with halo), working (accent, open), finished
 * (success, filled), failed (danger, dot), idle (muted ring), stopped (muted, dot), not confirmed (dashed).
 * Rows, the now line, Agents. The row's text says the state; the glyph is decoration for the screen reader.
 */
@Composable
fun StatusGlyph(state: AgentState, modifier: Modifier = Modifier) {
    val c = Oxe.colors
    val needsYou = c.attn
    val working = c.accent
    val finished = c.intentSuccessSolid
    val broken = c.intentDangerSolid
    val muted = c.textMuted
    Canvas(modifier.size(14.dp)) {
        val radius = size.minDimension / 2f
        val line = 1.5.dp.toPx()
        val ring = radius - line / 2f
        when (state) {
            AgentState.NEEDS_YOU -> {
                drawCircle(needsYou.copy(alpha = 0.28f), radius)
                drawCircle(needsYou, radius * 0.64f)
            }
            AgentState.WORKING -> drawArc(
                color = working,
                startAngle = -90f,
                sweepAngle = 270f,
                useCenter = false,
                topLeft = Offset(line / 2f, line / 2f),
                size = Size(size.width - line, size.height - line),
                style = Stroke(width = line, cap = StrokeCap.Round),
            )
            AgentState.FINISHED -> drawCircle(finished, radius * 0.86f)
            AgentState.FAILED -> {
                drawCircle(broken, ring, style = Stroke(width = line))
                drawCircle(broken, radius * 0.36f)
            }
            AgentState.IDLE -> drawCircle(muted, ring, style = Stroke(width = line))
            AgentState.STOPPED -> {
                drawCircle(muted, ring, style = Stroke(width = line))
                drawCircle(muted, radius * 0.36f)
            }
            AgentState.UNKNOWN -> drawCircle(
                color = muted,
                radius = ring,
                style = Stroke(width = line, pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 2.dp.toPx()))),
            )
        }
    }
}
