package com.oxespace.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.icons.OxeIcons
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace

/*
 * 1.5.0 F10 CR-A42. Test: ComponentsSnapshotTest.
 * Design: #627 HANDOFF-MOBILE.md: a 56 dp icon tile, a title, the text, and an optional action. Empty lists, "No longer
 * waiting".
 */
@Composable
fun EmptyState(
    title: String,
    text: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    action: NoticeAction? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space6),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space3),
    ) {
        Box(
            modifier = Modifier.size(56.dp).background(Oxe.colors.surfaceSunken, RoundedCornerShape(OxeRadius.xl)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon ?: OxeIcons.Inbox, contentDescription = null, tint = Oxe.colors.textMuted, modifier = Modifier.size(28.dp))
        }
        Text(text = title, color = Oxe.colors.textPrimary, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(text = text, color = Oxe.colors.textSecondary, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        if (action != null) {
            OxeButton(text = action.label, onClick = action.onClick, kind = OxeButtonKind.SECONDARY)
        }
    }
}
