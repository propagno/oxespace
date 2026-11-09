@file:Suppress("UNUSED_PARAMETER", "unused")

package com.oxespace.mobile.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector

/*
 * 1.5.0 F10 API skeleton (CR-A42), no behaviour; the CR-A42 task replaces the TODO. Test: ComponentsSnapshotTest.
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
    TODO("F10 CR-A42")
}
