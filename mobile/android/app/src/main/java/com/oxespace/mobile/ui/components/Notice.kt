package com.oxespace.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oxespace.mobile.ui.icons.OxeIcons
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeType

/*
 * 1.5.0 F10 CR-A42. Test: ComponentsSnapshotTest.
 * Design: #627 playground/HANDOFF-MOBILE.md "Components": `Notice(intent, icon, title, text, actions)`, a 32 dp icon
 * tile, a title (Plex 700, 15 sp), the text, and actions stacked full width. Every problem and explanation (MG5).
 * The colours are the intent roles only (MG4: AttnUsageTest checks this file never reads the needs-you tokens).
 */

/** The four Notice intents: the colours come from `intentInfo*`, `intentSuccess*`, `intentWarning*`, `intentDanger*`. */
enum class NoticeIntent { INFO, SUCCESS, WARNING, DANGER }

/** One full-width action under a Notice or an EmptyState. */
data class NoticeAction(val label: String, val onClick: () -> Unit)

private class NoticeColors(val background: Color, val border: Color, val solid: Color, val title: Color)

@Composable
private fun noticeColors(intent: NoticeIntent): NoticeColors {
    val c = Oxe.colors
    return when (intent) {
        NoticeIntent.INFO -> NoticeColors(c.intentInfoBg, c.intentInfoBorder, c.intentInfoSolid, c.intentInfoFg)
        NoticeIntent.SUCCESS -> NoticeColors(c.intentSuccessBg, c.intentSuccessBorder, c.intentSuccessSolid, c.intentSuccessFg)
        NoticeIntent.WARNING -> NoticeColors(c.intentWarningBg, c.intentWarningBorder, c.intentWarningSolid, c.intentWarningFg)
        NoticeIntent.DANGER -> NoticeColors(c.intentDangerBg, c.intentDangerBorder, c.intentDangerSolid, c.intentDangerFg)
    }
}

/** The icon each intent shows by default (the ported #606 paths); also the warning icon of the "No undo." line. */
@Composable
fun noticeIcon(intent: NoticeIntent): ImageVector = when (intent) {
    NoticeIntent.INFO -> OxeIcons.Info
    NoticeIntent.SUCCESS -> OxeIcons.CheckCircle
    NoticeIntent.WARNING -> OxeIcons.Warning
    NoticeIntent.DANGER -> OxeIcons.Danger
}

@Composable
fun Notice(
    intent: NoticeIntent,
    title: String,
    modifier: Modifier = Modifier,
    text: String? = null,
    icon: ImageVector? = null,
    actions: List<NoticeAction> = emptyList(),
) {
    val colors = noticeColors(intent)
    val shape = RoundedCornerShape(OxeRadius.lg)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.background, shape)
            .border(1.dp, colors.border, shape)
            .padding(OxeSpace.space4),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space3),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3), verticalAlignment = Alignment.Top) {
            Box(
                modifier = Modifier.size(32.dp).background(colors.solid, RoundedCornerShape(OxeRadius.md)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon ?: noticeIcon(intent), contentDescription = null, tint = Oxe.colors.textOnSolid, modifier = Modifier.size(18.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(OxeSpace.space1)) {
                Text(
                    text = title,
                    color = colors.title,
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = OxeType.weightBold),
                )
                if (text != null) {
                    Text(text = text, color = Oxe.colors.textPrimary, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        actions.forEachIndexed { index, action ->
            OxeButton(
                text = action.label,
                onClick = action.onClick,
                modifier = Modifier.fillMaxWidth(),
                kind = if (index == 0) OxeButtonKind.SECONDARY else OxeButtonKind.GHOST,
            )
        }
    }
}
