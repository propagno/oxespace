package com.oxespace.mobile.ui.components

import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.theme.Oxe

enum class OxeIconButtonVariant { Default, Danger, Accent }

/**
 * Standardized Mandacaru icon button with a minimum 48 dp touch target, theme-aware colors from [Oxe.colors],
 * and a required TalkBack [contentDescription].
 */
@Composable
fun OxeIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: OxeIconButtonVariant = OxeIconButtonVariant.Default,
    enabled: Boolean = true,
) {
    val c = Oxe.colors
    val contentColor = when (variant) {
        OxeIconButtonVariant.Default -> c.textPrimary
        OxeIconButtonVariant.Danger -> c.intentDangerFg
        OxeIconButtonVariant.Accent -> c.textAccent
    }
    IconButton(
        onClick = onClick,
        modifier = modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp),
        enabled = enabled,
        colors = IconButtonDefaults.iconButtonColors(
            contentColor = contentColor,
            disabledContentColor = c.textDisabled,
        ),
    ) {
        Icon(imageVector = icon, contentDescription = contentDescription)
    }
}
