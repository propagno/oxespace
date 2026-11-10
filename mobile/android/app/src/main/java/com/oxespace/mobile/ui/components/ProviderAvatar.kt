package com.oxespace.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeFonts
import com.oxespace.mobile.ui.theme.OxeIdentity
import com.oxespace.mobile.ui.theme.OxeType

/*
 * 1.5.0 F10 CR-A42. Test: ComponentsSnapshotTest.
 * Design: #627 HANDOFF-MOBILE.md: an 18 dp rounded square (22 dp in the thread) with C (Claude) or X (Codex). Rows, the
 * thread, requests. A provider the phone doesn't know gets a neutral tile, never a wrong letter.
 */

private class ProviderLook(val fill: Color, val letter: String, val label: String)

private fun providerLook(provider: String): ProviderLook? = when (provider.trim().lowercase()) {
    "claude" -> ProviderLook(OxeIdentity.providerClaude, "C", "Claude")
    "codex" -> ProviderLook(OxeIdentity.providerCodex, "X", "Codex")
    else -> null
}

@Composable
fun ProviderAvatar(provider: String, modifier: Modifier = Modifier, size: Dp = 18.dp) {
    val look = providerLook(provider)
    val shape = RoundedCornerShape(size * 0.28f)
    val fontSize = with(LocalDensity.current) { (size * 0.56f).toSp() }
    val tile = if (look != null) {
        modifier.size(size).background(look.fill, shape)
    } else {
        modifier.size(size).background(Oxe.colors.surfaceSunken, shape).border(1.dp, Oxe.colors.borderDefault, shape)
    }
    Box(
        modifier = tile.semantics { contentDescription = look?.label ?: provider },
        contentAlignment = Alignment.Center,
    ) {
        if (look != null) {
            Text(
                text = look.letter,
                color = Oxe.colors.textOnIdentity,
                style = TextStyle(fontFamily = OxeFonts.ui, fontWeight = OxeType.weightBold, fontSize = fontSize, lineHeight = fontSize),
            )
        }
    }
}
