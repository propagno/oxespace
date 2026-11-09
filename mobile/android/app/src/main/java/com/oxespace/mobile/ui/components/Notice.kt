@file:Suppress("UNUSED_PARAMETER", "unused")

package com.oxespace.mobile.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector

/*
 * 1.5.0 F10 API skeleton (CR-A42), no behaviour; the CR-A42 task replaces every TODO. Test: ComponentsSnapshotTest.
 * Design: #627 playground/HANDOFF-MOBILE.md "Components": `Notice(intent, icon, title, text, actions)`, a 32 dp icon
 * tile, a title (Plex 700, 15 sp), the text, and actions stacked full width. Every problem and explanation (MG5).
 */

/** The four Notice intents: the colours come from `intentInfo*`, `intentSuccess*`, `intentWarning*`, `intentDanger*`. */
enum class NoticeIntent { INFO, SUCCESS, WARNING, DANGER }

/** One full-width action under a Notice or an EmptyState. */
data class NoticeAction(val label: String, val onClick: () -> Unit)

/** The icon each intent shows by default (the ported #606 paths); also the warning icon of the "No undo." line. */
@Composable
fun noticeIcon(intent: NoticeIntent): ImageVector = TODO("F10 CR-A42")

@Composable
fun Notice(
    intent: NoticeIntent,
    title: String,
    modifier: Modifier = Modifier,
    text: String? = null,
    icon: ImageVector? = null,
    actions: List<NoticeAction> = emptyList(),
) {
    TODO("F10 CR-A42")
}
