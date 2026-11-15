package com.oxespace.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeFonts
import com.oxespace.mobile.ui.theme.OxeIdentity
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeType

/*
 * 1.5.0 F10 CR-A42; 1.5.2 A9 v3 (CR-F3-6). Tests: ComponentsSnapshotTest, ConversationActionsTest.
 * Design: #627 HANDOFF-MOBILE.md: an 18 dp rounded square (22 dp in the thread) with C (Claude) or X (Codex). Rows, the
 * thread, requests. A provider the phone doesn't know gets a neutral tile, never a wrong letter. One node: role Image,
 * read as the provider's name; the letter is drawn, never a text of its own.
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
    val shape = RoundedCornerShape(OxeRadius.sm)
    // The letter is 0.56 of the tile, never under 11 (BRD-07): the 18 dp tile drew it at 10 sp. Sized in dp, as the tile is.
    val fontSize = with(LocalDensity.current) { maxOf(size * 0.56f, 11.dp).toSp() }
    val measurer = rememberTextMeasurer()
    val letterStyle = TextStyle(color = Oxe.colors.textOnIdentity, fontFamily = OxeFonts.ui, fontWeight = OxeType.weightBold, fontSize = fontSize, lineHeight = fontSize)
    val tile = if (look != null) {
        // The letter is drawn, not composed as a Text: no semantics node of its own, even in the unmerged tree.
        modifier.size(size).background(look.fill, shape).drawBehind {
            val glyph = measurer.measure(look.letter, letterStyle)
            drawText(glyph, topLeft = Offset((this.size.width - glyph.size.width) / 2f, (this.size.height - glyph.size.height) / 2f))
        }
    } else {
        modifier.size(size).background(Oxe.colors.surfaceSunken, shape).border(1.dp, Oxe.colors.borderDefault, shape)
    }
    Box(
        modifier = tile.clearAndSetSemantics {
            contentDescription = look?.label ?: provider
            role = Role.Image
        },
    )
}
