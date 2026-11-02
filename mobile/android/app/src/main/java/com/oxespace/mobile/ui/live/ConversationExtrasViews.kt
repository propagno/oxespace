package com.oxespace.mobile.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.protocol.showHidden
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeCodeStyle
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace

/** A short duration for the turn line: "45 s", "3 min", "1 h". */
@Composable
fun shortDuration(ms: Long): String {
    val seconds = (ms / 1000).coerceAtLeast(0)
    return when {
        seconds < 60 -> stringResource(R.string.thread_extras_seconds, seconds.toString())
        seconds < 3600 -> stringResource(R.string.thread_extras_minutes, (seconds / 60).toString())
        else -> stringResource(R.string.thread_extras_hours, (seconds / 3600).toString())
    }
}

/**
 * Under the title while a turn runs: "Working · 3 min", and once the agent has been silent past [QUIET_HINT_AFTER_MS],
 * "No output for 4 min" in the warning colour, so a stuck turn doesn't read as working.
 */
@Composable
fun TurnTimer(clock: TurnClock, modifier: Modifier = Modifier) {
    val now = LocalClock.current()
    val quiet = quietFor(clock, now)?.takeIf { it >= QUIET_HINT_AFTER_MS }
    Column(modifier) {
        Text(stringResource(R.string.thread_extras_working, shortDuration(turnElapsed(clock, now))), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
        if (quiet != null) {
            Text(
                stringResource(R.string.thread_extras_quiet, shortDuration(quiet)),
                style = MaterialTheme.typography.labelMedium,
                color = Oxe.colors.intentWarningFg,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

/** Above the composer: what is waiting to be sent, oldest first, so the person sees their message is there. */
@Composable
fun QueuedPreview(preview: List<QueuedMessage>, queued: Int, modifier: Modifier = Modifier) {
    val (shown, more) = shownQueue(preview, queued)
    if (queued <= 0) return
    Column(
        modifier.fillMaxWidth().padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2)
            .background(Oxe.colors.surfaceRaised, RoundedCornerShape(OxeRadius.md))
            .border(1.dp, Oxe.colors.borderSubtle, RoundedCornerShape(OxeRadius.md)).padding(OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        Text(stringResource(R.string.thread_extras_queued, queued.toString()), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary, modifier = Modifier.semantics { heading() })
        for (message in shown) {
            Text(displaySafe(message.text, 200) + if (message.truncated) "…" else "", style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (more > 0) Text(stringResource(R.string.thread_extras_queued_more, more.toString()), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted)
    }
}

/**
 * A tool step's diff, read-only: each file with its counts ("Binary file" instead for one), then the patch with hidden
 * characters written out, and a note when the rest is only on the computer.
 */
@Composable
fun ToolDiffView(diff: ToolDiff, modifier: Modifier = Modifier) {
    val shown = shownDiff(diff)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
        for (file in shown.files) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                Text(showHidden(file.path), style = OxeCodeStyle, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (file.binary) {
                    Text(stringResource(R.string.thread_extras_binary), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted)
                } else {
                    Text("+${file.additions}", style = MaterialTheme.typography.labelMedium, color = Oxe.colors.intentSuccessFg)
                    Text("−${file.deletions}", style = MaterialTheme.typography.labelMedium, color = Oxe.colors.intentDangerFg)
                }
            }
        }
        shown.patch?.takeIf { it.isNotEmpty() }?.let { CodeBlock(showHidden(it)) }
        if (shown.truncated) Text(stringResource(R.string.thread_extras_diff_cut), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted)
    }
}
