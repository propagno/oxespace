@file:Suppress("UNUSED_PARAMETER", "unused")

package com.oxespace.mobile.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/*
 * 1.5.0 F10 API skeleton (CR-A42), no behaviour; the CR-A42 task replaces the TODO. Test: ComponentsSnapshotTest.
 * Design: #627 HANDOFF-MOBILE.md: 48 dp tall, 12 dp radius. Primary (accent), secondary (raised + border), ghost (fill +
 * accent text), danger (soft danger). Everywhere; it replaces the pill buttons. Deny is never danger red (§6).
 */

enum class OxeButtonKind { PRIMARY, SECONDARY, GHOST, DANGER }

@Composable
fun OxeButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: OxeButtonKind = OxeButtonKind.PRIMARY,
    enabled: Boolean = true,
) {
    TODO("F10 CR-A42")
}
