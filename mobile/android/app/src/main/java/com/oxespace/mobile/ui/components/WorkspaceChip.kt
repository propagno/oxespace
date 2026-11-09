package com.oxespace.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeColors

/** The fill and the text of a workspace chip. */
data class WorkspaceChipColors(val background: Color, val content: Color)

/**
 * The desktop's workspace slot (RemoteWorkspace.color, 1–8) through the generated `wsN` / `wsNFg` tokens. Null for an
 * absent slot (an older desktop) or one this app doesn't know (a newer desktop): the caller draws the neutral chip.
 */
fun workspaceChipColors(slot: Int?, colors: OxeColors): WorkspaceChipColors? = when (slot) {
    1 -> WorkspaceChipColors(colors.ws1, colors.ws1Fg)
    2 -> WorkspaceChipColors(colors.ws2, colors.ws2Fg)
    3 -> WorkspaceChipColors(colors.ws3, colors.ws3Fg)
    4 -> WorkspaceChipColors(colors.ws4, colors.ws4Fg)
    5 -> WorkspaceChipColors(colors.ws5, colors.ws5Fg)
    6 -> WorkspaceChipColors(colors.ws6, colors.ws6Fg)
    7 -> WorkspaceChipColors(colors.ws7, colors.ws7Fg)
    8 -> WorkspaceChipColors(colors.ws8, colors.ws8Fg)
    else -> null
}

/** The workspace's name in its desktop colour; the neutral chip when the slot is absent or unknown. */
@Composable
fun WorkspaceChip(name: String, slot: Int?, modifier: Modifier = Modifier) {
    val colors = Oxe.colors
    val slotColors = workspaceChipColors(slot, colors)
    // A slot fill is strong; the chip shows a tint of it with the slot's readable foreground.
    val background = slotColors?.background?.copy(alpha = 0.16f) ?: MaterialTheme.colorScheme.surfaceVariant
    val content = slotColors?.content ?: colors.textSecondary
    Text(
        text = name,
        color = content,
        style = MaterialTheme.typography.labelMedium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier
            .background(background, RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}
