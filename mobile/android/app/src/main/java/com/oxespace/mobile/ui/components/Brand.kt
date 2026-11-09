package com.oxespace.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.icons.OxeIcons
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace

/*
 * 1.5.0 F10 CR-A42b-2 (M1). Tests: ScreensMatchHandoffTest, the Home goldens.
 * Design: #627 HANDOFF-MOBILE.md: OxeMark (the Mandacaru mark in an accent tile, 28 % radius, 30 / 64 dp), the
 * computer card, and a skeleton while connecting.
 */

/** The Mandacaru mark of resources/icon.svg (44 units): the cactus in the tile's text colour, the sun in its own. */
private fun markVector(stroke: Color, sun: Color): ImageVector = ImageVector.Builder(
    name = "OxeMark", defaultWidth = 44.dp, defaultHeight = 44.dp, viewportWidth = 44f, viewportHeight = 44f,
).addPath(
    pathData = addPathNodes("M22,39V8M22,27h-6a4,4 0,0 1,-4 -4v-7M22,21h6a4,4 0,0 0,4 -4v-6"),
    stroke = SolidColor(stroke), strokeLineWidth = 4f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
).addPath(
    pathData = addPathNodes("M12.4,11.2m-2.8,0a2.8,2.8 0,1 1,5.6 0a2.8,2.8 0,1 1,-5.6 0"),
    fill = SolidColor(sun),
).build()

/** The brand mark in its accent tile; decorative (the screen's title names the app). */
@Composable
fun OxeMark(size: Dp = 30.dp, modifier: Modifier = Modifier) {
    val colors = Oxe.colors
    Box(
        modifier.size(size).background(colors.brandMark, RoundedCornerShape(size * 0.28f)).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Icon(markVector(Color.White, colors.brandSun), contentDescription = null, tint = Color.Unspecified, modifier = Modifier.size(size * 0.78f))
    }
}

/**
 * Grey blocks where content will be, while connecting. Steady on purpose: the connecting line beside it already says
 * something is happening, and an endless pulse would never let the screen settle (tests, TalkBack, reduced motion).
 */
@Composable
fun Skeleton(modifier: Modifier = Modifier, lines: Int = 3) {
    Column(modifier.fillMaxWidth().clearAndSetSemantics {}, verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
        repeat(lines) { i ->
            Box(
                Modifier.fillMaxWidth(if (i == lines - 1) 0.6f else 1f).height(14.dp)
                    .background(Oxe.colors.surfaceSunken, RoundedCornerShape(6.dp)),
            )
        }
    }
}

/** The paired computer: its name and how the phone stands with it, in one raised card. */
@Composable
fun ComputerCard(name: String, status: String, modifier: Modifier = Modifier, connecting: Boolean = false) {
    val colors = Oxe.colors
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier.fillMaxWidth().background(colors.surfaceRaised, shape).border(1.dp, colors.borderSubtle, shape).padding(OxeSpace.space4)
            .semantics(mergeDescendants = true) { contentDescription = "$name, $status" },
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space3),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).background(colors.surfaceSunken, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Icon(OxeIcons.Monitor, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(22.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.titleMedium, color = colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(status, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
            }
        }
        if (connecting) Skeleton(lines = 2)
    }
}
