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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
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
import com.oxespace.mobile.ui.icons.OxeIcons
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeFonts
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeType

/*
 * 1.5.0 F10 CR-A42b-2 (M2). Tests: ScreensMatchHandoffTest, the Pairing goldens.
 * Design: #627 HANDOFF-MOBILE.md: PairingStepper (four steps; done, now and failed), CodeBoxes (6 mono boxes,
 * 44 × 60 dp, 3 + 3), Viewfinder (a dark square with corner guides, accent or warning when the code is wrong, and the
 * scan line).
 */

/**
 * Where a pairing stands: [current] is the step in progress (0-based); [failed] marks it as the one that failed.
 * 1.5.2 A14 (MOB-7): numbered circles, the done ones with a check; the whole row is one stop for TalkBack ("3/4: …").
 */
@Composable
fun PairingStepper(labels: List<String>, current: Int, modifier: Modifier = Modifier, failed: Boolean = false) {
    val colors = Oxe.colors
    // OXE-363 (A6): once paired (current = labels.size, every step done) the row still speaks its last step.
    val step = if (current >= labels.size) labels.lastIndex else current
    val spoken = labels.getOrNull(step)?.let { "${step + 1}/${labels.size}: $it" }.orEmpty()
    Row(
        modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = spoken },
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        labels.forEachIndexed { i, label ->
            val done = i < current
            val now = i == current
            val fill = when {
                now && failed -> colors.intentDangerSolid
                done -> colors.accent
                else -> colors.surfaceRaised
            }
            val ring = when {
                now && failed -> colors.intentDangerSolid
                done || now -> colors.accent
                else -> colors.borderDefault
            }
            val mark = when {
                (now && failed) || done -> colors.textOnAccent
                now -> colors.textAccent
                else -> colors.textMuted
            }
            Column(
                Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
            ) {
                Box(
                    Modifier.size(28.dp).background(fill, CircleShape).border(2.dp, ring, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    if (done) {
                        Icon(OxeIcons.Check, contentDescription = null, tint = mark, modifier = Modifier.size(16.dp))
                    } else {
                        Text(
                            (i + 1).toString(),
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"),
                            color = mark,
                        )
                    }
                }
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
                    .background(colors.surfaceRaised, RoundedCornerShape(OxeRadius.md))
                    .border(1.dp, colors.borderStrong, RoundedCornerShape(OxeRadius.md)),
                contentAlignment = Alignment.Center,
            ) {
                Text(char.toString(), fontFamily = OxeFonts.mono, fontSize = OxeType.textDisplay, color = colors.textPrimary, textAlign = TextAlign.Center)
            }
        }
    }
}

/** The camera in a dark square, with the corner guides and the scan line; [warning] when the last code was wrong. */
@Composable
fun Viewfinder(warning: Boolean, modifier: Modifier = Modifier, camera: @Composable (Modifier) -> Unit) {
    val colors = Oxe.colors
    val guide = if (warning) colors.intentWarningSolid else colors.accent
    Box(modifier.clip(RoundedCornerShape(OxeRadius.xl)).background(colors.termBg)) {
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
