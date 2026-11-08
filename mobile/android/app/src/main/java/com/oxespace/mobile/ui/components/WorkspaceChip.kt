@file:Suppress("UNUSED_PARAMETER", "unused")

package com.oxespace.mobile.ui.components

import androidx.compose.ui.graphics.Color
import com.oxespace.mobile.ui.theme.OxeColors

/*
 * 1.5.0 F10 API skeleton (A42/A67), no behaviour; MOB-A42 replaces the TODO. Test: WorkspaceChipTest.
 */

/** A workspace chip's colours: the slot's `wsN` background and `wsNFg` content. */
data class WorkspaceChipColors(val background: Color, val content: Color)

/** Slots 1–8 map to their tokens; anything else (absent, out of range) is the neutral chip, null. */
fun workspaceChipColors(slot: Int?, colors: OxeColors): WorkspaceChipColors? = TODO("F10 A42")
