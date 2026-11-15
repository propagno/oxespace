package com.oxespace.mobile.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemoteThreadItem
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.protocol.showHidden
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeCodeStyle
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace

/*
 * 1.5.2 A12 (OXE-19 CA-5): a tool call in the phone's conversation is a compact card, as OxeChat's: the tool's name as
 * the agent called it ("Bash"), its state in words, and its summary (the target: the command, the file) in Plex Mono.
 * One TalkBack stop, at least 48 dp tall; a tap opens it to its output and diff and closes it again, and the open or
 * closed state is said in the phone's language. BRD-07 (OXE-69): nothing under 11 sp, radii only OxeRadius.
 */

/** One tool call as a compact card; [indent] when it is drawn inside an opened group of steps. */
@Composable
internal fun StepRow(tool: RemoteThreadItem.Tool, indent: Boolean = false) {
    var open by rememberSaveable(tool.id) { mutableStateOf(false) }
    val output = tool.output?.takeIf { it.isNotEmpty() }
    // The diff opens with the output, behind the same tap, inside a screen that already blocks screenshots.
    val diff = tool.diff?.takeIf { it.files.isNotEmpty() || !it.patch.isNullOrEmpty() }
    val opens = output != null || diff != null
    val name = displaySafe(tool.name, NAME_MAX)
    val target = displaySafe(tool.detail, TARGET_MAX)
    val state = toolStateLabel(tool.state)
    val verb = stringResource(verbRes(stepKind(tool.name)))
    val count = tool.filesChanged?.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.thread_files_changed, it.toInt(), it.toInt()) }
    val spoken = listOfNotNull(name, state, "$verb $target".trim(), count).filter { it.isNotBlank() }.joinToString(", ")
    val collapsed = stringResource(R.string.thread_step_collapsed)
    val expanded = stringResource(R.string.thread_step_expanded)
    val shape = RoundedCornerShape(OxeRadius.md)
    Column(
        Modifier.fillMaxWidth().padding(start = if (indent) INDENT else 0.dp),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .clip(shape)
                .background(Oxe.colors.surfaceRaised, shape)
                .border(1.dp, Oxe.colors.borderSubtle, shape)
                .then(if (opens) Modifier.clickable(role = Role.Button) { open = !open } else Modifier)
                .semantics(mergeDescendants = true) {
                    contentDescription = spoken
                    if (opens) stateDescription = if (open) expanded else collapsed
                }
                .padding(horizontal = OxeSpace.space3, vertical = OxeSpace.space2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            StepIcon(tool.state)
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                    Text(
                        name,
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = Oxe.colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Text(state, style = MaterialTheme.typography.labelMedium, color = stateColor(tool.state), maxLines = 1)
                }
                if (target.isNotEmpty()) {
                    Text(
                        target,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = OxeCodeStyle.fontFamily),
                        color = Oxe.colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.MiddleEllipsis,
                    )
                }
            }
            count?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted) }
            if (opens) Chevron(open)
        }
        tool.redacted?.takeIf { it > 0 }?.let {
            Text(pluralStringResource(R.plurals.terminal_redacted, it.toInt(), it.toInt()), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted)
        }
        // What is shown is what Copiar copies: hidden characters written out, never obeyed.
        if (open && output != null) Box { CodeBlock(showHidden(output)) }
        if (open && diff != null) ToolDiffView(diff)
    }
}

/** The state word's colour, by token: the danger tint only for a failed call. */
@Composable
private fun stateColor(state: String): Color = when (state) {
    "running" -> Oxe.colors.accent
    "failed" -> Oxe.colors.intentDangerFg
    "completed" -> Oxe.colors.intentSuccessFg
    else -> Oxe.colors.textMuted
}

/** The state glyph; the card says the state in words, so the glyph is only for the eye. */
@Composable
internal fun StepIcon(state: String) {
    Box(Modifier.width(18.dp), contentAlignment = Alignment.Center) {
        val style = MaterialTheme.typography.bodyMedium
        when (state) {
            "running" -> Spinner()
            "failed" -> Text("✕", style = style, color = Oxe.colors.intentDangerFg, fontWeight = FontWeight.Bold)
            "completed" -> Text("✓", style = style, color = Oxe.colors.intentSuccessFg, fontWeight = FontWeight.Bold)
            else -> Text("·", style = style, color = Oxe.colors.textMuted)
        }
    }
}

@Composable
internal fun Spinner() {
    CircularProgressIndicator(Modifier.size(14.dp).semantics { hideFromAccessibility() }, color = Oxe.colors.accent, trackColor = Oxe.colors.borderSubtle, strokeWidth = 2.dp)
}

@Composable
internal fun Chevron(open: Boolean) {
    Icon(ImageVector.vectorResource(R.drawable.ic_chevron), contentDescription = null, tint = Oxe.colors.textMuted, modifier = Modifier.size(20.dp).rotate(if (open) 90f else 0f))
}

private fun verbRes(kind: StepKind) = when (kind) {
    StepKind.READ -> R.string.thread_verb_read
    StepKind.RUN -> R.string.thread_verb_run
    StepKind.EDIT -> R.string.thread_verb_edit
    StepKind.CREATE -> R.string.thread_verb_create
    StepKind.SEARCH -> R.string.thread_verb_search
    StepKind.OTHER -> R.string.thread_verb_other
}

private val INDENT = 26.dp
private const val NAME_MAX = 60
private const val TARGET_MAX = 160
