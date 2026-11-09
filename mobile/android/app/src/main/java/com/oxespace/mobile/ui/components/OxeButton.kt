package com.oxespace.mobile.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeType

/*
 * 1.5.0 F10 CR-A42. Test: ComponentsSnapshotTest.
 * Design: #627 HANDOFF-MOBILE.md: 48 dp tall, 12 dp radius. Primary (accent), secondary (raised + border), ghost (fill +
 * accent text), danger (soft danger). Everywhere; it replaces the pill buttons. Deny is never danger red (§6).
 */

enum class OxeButtonKind { PRIMARY, SECONDARY, GHOST, DANGER }

private class OxeButtonColors(val container: Color, val content: Color, val border: Color?)

@Composable
private fun oxeButtonColors(kind: OxeButtonKind): OxeButtonColors {
    val c = Oxe.colors
    return when (kind) {
        OxeButtonKind.PRIMARY -> OxeButtonColors(c.accent, c.textOnAccent, null)
        OxeButtonKind.SECONDARY -> OxeButtonColors(c.surfaceRaised, c.textPrimary, c.borderDefault)
        OxeButtonKind.GHOST -> OxeButtonColors(c.fillHover, c.textAccent, null)
        OxeButtonKind.DANGER -> OxeButtonColors(c.intentDangerBg, c.intentDangerFg, c.intentDangerBorder)
    }
}

@Composable
fun OxeButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: OxeButtonKind = OxeButtonKind.PRIMARY,
    enabled: Boolean = true,
    /** CR-A42b-2: a label in another family, e.g. the terminal keys in Plex Mono (DESIGN #744). */
    fontFamily: androidx.compose.ui.text.font.FontFamily? = null,
) {
    val colors = oxeButtonColors(kind)
    val c = Oxe.colors
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = 48.dp),
        enabled = enabled,
        shape = RoundedCornerShape(OxeRadius.lg),
        colors = ButtonDefaults.buttonColors(
            containerColor = colors.container,
            contentColor = colors.content,
            disabledContainerColor = c.surfaceSunken,
            disabledContentColor = c.textDisabled,
        ),
        border = colors.border?.let { BorderStroke(1.dp, if (enabled) it else c.borderSubtle) },
        contentPadding = PaddingValues(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge.copy(fontWeight = OxeType.weightSemibold, fontFamily = fontFamily ?: MaterialTheme.typography.labelLarge.fontFamily),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
