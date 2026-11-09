package com.oxespace.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeFonts
import com.oxespace.mobile.ui.theme.OxeSpace

/*
 * 1.5.0 F10 CR-A42b-2 (M4). Tests: ScreensMatchHandoffTest, the Conversation goldens.
 * Design: #627 HANDOFF-MOBILE.md: NowBanner (an attnBg strip under the app bar, "Needs you" with Review), GateCard (an
 * inline request card with an attn left edge: risk, title, where, Deny and Review), StepsSummary (a 48 dp chip, "N
 * steps · read …, ran …", with a chevron). The sun (attn) here means "needs you", and only that (MG4).
 */

/** Under the app bar while the conversation waits on the person: what it asks, and Review. */
@Composable
fun NowBanner(text: String, review: String, onReview: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Oxe.colors
    Row(
        modifier.fillMaxWidth().background(colors.attnBg).padding(start = OxeSpace.space4, end = OxeSpace.space2)
            .heightIn(min = 48.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        Box(Modifier.width(8.dp).height(8.dp).background(colors.attn, RoundedCornerShape(4.dp)))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = colors.attnFg, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        OxeButton(review, onClick = onReview, kind = OxeButtonKind.GHOST)
    }
}

/**
 * A request inside the conversation: the attn edge, [risk] (the RiskChip), the title, where it runs, then Deny and
 * Review. Deny goes through the same biometric gate as the Request screen; Review opens it.
 */
@Composable
fun GateCard(
    title: String,
    where: String?,
    deny: String,
    review: String,
    denyEnabled: Boolean,
    onDeny: (() -> Unit)?,
    onReview: () -> Unit,
    modifier: Modifier = Modifier,
    risk: @Composable () -> Unit = {},
) {
    val colors = Oxe.colors
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(shape).background(colors.surfaceRaised).border(1.dp, colors.attnBorder, shape),
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(colors.attn))
        Column(Modifier.weight(1f).padding(OxeSpace.space3), verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
            risk()
            Text(title, style = MaterialTheme.typography.titleSmall, color = colors.textPrimary, maxLines = 3, overflow = TextOverflow.Ellipsis)
            where?.let { Text(it, fontFamily = OxeFonts.mono, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                // Deny is the safe answer: secondary, never danger red (§6).
                if (onDeny != null) OxeButton(deny, onClick = onDeny, enabled = denyEnabled, kind = OxeButtonKind.SECONDARY, modifier = Modifier.weight(1f))
                OxeButton(review, onClick = onReview, modifier = Modifier.weight(1f))
            }
        }
    }
}

/** The tool steps of a turn folded into one chip; a tap opens them. */
@Composable
fun StepsSummary(summary: String, failed: Boolean, open: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier, glyph: @Composable () -> Unit = {}, trailing: @Composable () -> Unit = {}) {
    val colors = Oxe.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
            .background(if (failed) colors.intentDangerBg else colors.surfaceSunken)
            .clickable(role = Role.Button, onClick = onToggle)
            .padding(horizontal = OxeSpace.space3)
            .semantics { stateDescription = if (open) "expanded" else "collapsed" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        glyph()
        Text(summary, style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        trailing()
    }
}
