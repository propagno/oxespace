package com.oxespace.mobile.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeType

/*
 * 1.5.0 F10 CR-A42b-2 (M8, M6). Tests: ScreensMatchHandoffTest, the Settings and Terminal goldens.
 * Design: #627 HANDOFF-MOBILE.md: SettingsRow, OxeSwitch (48 dp target) and Segmented, the Settings anatomy; the
 * terminal's "View" (Screen · Conversation) is the same Segmented.
 */

/** One choice among a few, all visible: each option is a 48 dp tab in one rounded track. */
@Composable
fun Segmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val colors = Oxe.colors
    val track = RoundedCornerShape(12.dp)
    Row(
        modifier.fillMaxWidth().clip(track).background(colors.surfaceSunken).border(1.dp, colors.borderSubtle, track).padding(3.dp).selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            Box(
                Modifier.weight(1f).heightIn(min = 42.dp).clip(RoundedCornerShape(9.dp))
                    .background(if (on) colors.surfaceRaised else colors.surfaceSunken)
                    .selectable(selected = on, role = Role.Tab) { onSelect(i) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = if (on) OxeType.weightSemibold else null),
                    color = if (on) colors.textPrimary else colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** The app's switch: a 48 dp target around a 44 × 26 dp track; the accent when on. Its row carries the toggle. */
@Composable
fun OxeSwitch(checked: Boolean, modifier: Modifier = Modifier) {
    val colors = Oxe.colors
    val knob by animateDpAsState(if (checked) 20.dp else 2.dp, label = "switch")
    Box(modifier.size(width = 48.dp, height = 48.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(width = 44.dp, height = 26.dp).clip(CircleShape)
                .background(if (checked) colors.accent else colors.surfaceSunken)
                .border(1.dp, if (checked) colors.accent else colors.borderStrong, CircleShape),
        ) {
            Box(
                Modifier.offset { IntOffset(knob.roundToPx(), 2.dp.roundToPx()) }.size(22.dp).clip(CircleShape)
                    .background(if (checked) colors.textOnAccent else colors.textSecondary),
            )
        }
    }
}

/**
 * A settings row: title, optional text, and [trailing] at its end (an OxeSwitch, a value). With [checked] the whole row
 * is the toggle (one target, read as a switch by TalkBack).
 */
@Composable
fun SettingsRow(title: String, modifier: Modifier = Modifier, text: String? = null, checked: Boolean? = null, onCheckedChange: ((Boolean) -> Unit)? = null, trailing: @Composable () -> Unit = {}) {
    val colors = Oxe.colors
    val toggle = if (checked != null && onCheckedChange != null) Modifier.toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange) else Modifier
    Row(
        modifier.fillMaxWidth().heightIn(min = 56.dp).then(toggle).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
            text?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary) }
        }
        trailing()
    }
}
