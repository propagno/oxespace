package com.oxespace.mobile.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeFonts
import com.oxespace.mobile.ui.theme.OxeSpace

/*
 * 1.5.0 F10 CR-A42b-2 (M2). Tests: ScreensMatchHandoffTest, the Pairing goldens.
 * Design: #627 HANDOFF-MOBILE.md: PairingStepper (four steps; done, now and failed), CodeBoxes (6 mono boxes,
 * 44 × 60 dp, 3 + 3), Viewfinder (a dark square with corner guides, accent or warning when the code is wrong, and the
 * scan line).
 */

/** Where a pairing stands: [current] is the step in progress (0-based); [failed] marks it as the one that failed. */
@Composable
fun PairingStepper(labels: List<String>, current: Int, modifier: Modifier = Modifier, failed: Boolean = false) {
    val colors = Oxe.colors
    val spoken = labels.getOrNull(current)?.let { "${current + 1}/${labels.size}: $it" }.orEmpty()
    Row(
        modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = spoken },
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        labels.forEachIndexed { i, label ->
            val done = i < current
            val now = i == current
            val bar = when {
                now && failed -> colors.intentDangerSolid
                done || now -> colors.accent
                else -> colors.borderDefault
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(OxeSpace.space1)) {
                Box(Modifier.fillMaxWidth().height(4.dp).background(bar, RoundedCornerShape(2.dp)))
                Text(
                    label,
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = if (now) FontWeight.SemiBold else FontWeight.Normal),
                    color = when {
                        now && failed -> colors.intentDangerFg
                        now -> colors.textPrimary
                        else -> colors.textMuted
                    },
                    maxLines = 1,
                )
            }
        }
    }
}

/** The verification code in six mono boxes, grouped 3 + 3, as the desktop shows it. */
@Composable
fun CodeBoxes(code: String, spoken: String, modifier: Modifier = Modifier) {
    val colors = Oxe.colors
    Row(
        modifier.clearAndSetSemantics { contentDescription = spoken },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        code.take(6).forEachIndexed { i, char ->
            if (i == 3) Box(Modifier.width(10.dp))
            Box(
                Modifier.size(width = 44.dp, height = 60.dp)
                    .background(colors.surfaceRaised, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderStrong, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(char.toString(), fontFamily = OxeFonts.mono, fontSize = 28.sp, color = colors.textPrimary, textAlign = TextAlign.Center)
            }
        }
    }
}

/** The camera in a dark square, with the corner guides and the scan line; [warning] when the last code was wrong. */
@Composable
fun Viewfinder(warning: Boolean, modifier: Modifier = Modifier, camera: @Composable (Modifier) -> Unit) {
    val colors = Oxe.colors
    val guide = if (warning) colors.intentWarningSolid else colors.accent
    Box(modifier.clip(RoundedCornerShape(16.dp)).background(colors.termBg)) {
        camera(Modifier.fillMaxSize())
        Canvas(Modifier.fillMaxSize().padding(16.dp).semantics { }) {
            val len = size.minDimension * 0.18f
            val w = 4.dp.toPx()
            val corners = listOf(
                Offset(0f, 0f) to Pair(Offset(len, 0f), Offset(0f, len)),
                Offset(size.width, 0f) to Pair(Offset(size.width - len, 0f), Offset(size.width, len)),
                Offset(0f, size.height) to Pair(Offset(len, size.height), Offset(0f, size.height - len)),
                Offset(size.width, size.height) to Pair(Offset(size.width - len, size.height), Offset(size.width, size.height - len)),
            )
            for ((corner, ends) in corners) {
                drawLine(guide, corner, ends.first, w, StrokeCap.Round)
                drawLine(guide, corner, ends.second, w, StrokeCap.Round)
            }
            // The scan line, steady across the middle: it shows where to hold the code.
            drawLine(guide.copy(alpha = 0.7f), Offset(len / 2, size.height / 2), Offset(size.width - len / 2, size.height / 2), 2.dp.toPx(), StrokeCap.Round)
        }
        if (warning) Box(Modifier.align(Alignment.TopEnd).padding(10.dp).size(10.dp).background(colors.intentWarningSolid, CircleShape))
    }
}
