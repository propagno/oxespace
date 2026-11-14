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
import com.oxespace.mobile.ui.theme.OxeIdentity
import com.oxespace.mobile.ui.theme.OxeSpace

/*
 * 1.5.0 F10 CR-A42b-2 (M1). Tests: ScreensMatchHandoffTest, the Home goldens.
 * Design: #627 HANDOFF-MOBILE.md: OxeMark (the Mandacaru mark in an accent tile, 28 % radius, 30 / 64 dp), the
 * computer card, and a skeleton while connecting.
 */

/**
 * The Ramo mark of resources/icon.svg (48 units, src/design/brand.ts > MARK_PATH; tests/brand-touchpoints.test.ts keeps
 * them equal): five solid columns, one fill.
 */
private val markVector: ImageVector = ImageVector.Builder(
    name = "OxeMark", defaultWidth = 48.dp, defaultHeight = 48.dp, viewportWidth = 48f, viewportHeight = 48f,
).addPath(
    pathData = addPathNodes("M24 5a4 4 0 0 1 4 4v30a4 4 0 0 1 -8 0v-30a4 4 0 0 1 4 -4zM12 15a4 4 0 0 1 4 4v10a4 4 0 0 1 -8 0v-10a4 4 0 0 1 4 -4zM12 25h8a4 4 0 0 1 0 8h-8a4 4 0 0 1 0 -8zM36 9a4 4 0 0 1 4 4v9a4 4 0 0 1 -8 0v-9a4 4 0 0 1 4 -4zM28 18h8a4 4 0 0 1 0 8h-8a4 4 0 0 1 0 -8z"),
    fill = SolidColor(OxeIdentity.logoMark),
).build()

/** The app icon: the caatinga Ramo on the night tile, the same in both modes. Decorative (the screen's title names the app). */
@Composable
fun OxeMark(modifier: Modifier = Modifier, size: Dp = 30.dp) {
    Box(
        modifier.size(size).background(OxeIdentity.logoTile, RoundedCornerShape(size * 0.23f)).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Icon(markVector, contentDescription = null, tint = Color.Unspecified, modifier = Modifier.size(size * 0.75f))
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
                    // CR-F10-10e (DESIGN #744): borderDefault reads against the canvas in both themes (1.37:1 light,
                    // 1.62:1 dark); surfaceSunken measured 1.07:1 and 1.00:1, so the screen looked empty.
                    .background(Oxe.colors.borderDefault, RoundedCornerShape(6.dp)),
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
