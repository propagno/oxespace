package com.oxespace.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.ui.icons.OxeIcons
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeFonts
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace

/*
 * 1.5.0 F10 CR-A42b-2 (M4); 1.5.2 A9 (OXE-102 CA-5, CA-6). Tests: ScreensMatchHandoffTest, ConversationActionsTest,
 * the Conversation goldens.
 * Design: #627 HANDOFF-MOBILE.md: NowBanner (one tappable line under the app bar: the sun, "Needs you." in bold, what
 * it asks, and "Review ›" as text; the whole line opens the request), GateCard (a neutral inline request card whose one
 * signal is the risk chip: risk, title, where, Deny and Review, the screen's one Review button), StepsSummary (a 48 dp
 * chip, "N steps · read …, ran …", with a chevron). The sun (attn) here means "needs you", and only that (MG4).
 */

/** Under the app bar while the conversation waits on the person: one line, the whole of it opens the request. */
@Composable
fun NowBanner(lead: String, text: String, review: String, onReview: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Oxe.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).background(colors.attnBg)
            .clickable(role = Role.Button, onClick = onReview)
            .padding(horizontal = OxeSpace.space4)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        Icon(OxeIcons.Sun, contentDescription = null, tint = colors.attnFg, modifier = Modifier.size(18.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("$lead.") }
                append(" ")
                append(text)
            },
            style = MaterialTheme.typography.bodyMedium,
            color = colors.attnFg,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text("$review \u203A", style = MaterialTheme.typography.labelLarge, color = colors.attnFg, maxLines = 1)
    }
}

/**
 * A request inside the conversation: a neutral raised card whose one signal is [risk] (the RiskChip), then the title,
 * where it runs, Deny and Review. Deny goes through the same biometric gate as the Request screen; Review opens it.
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
    val shape = RoundedCornerShape(OxeRadius.lg)
    Column(
        modifier.fillMaxWidth().clip(shape).background(colors.surfaceRaised).border(1.dp, colors.borderSubtle, shape).padding(OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
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

/** The tool steps of a turn folded into one chip; a tap opens them. */
@Composable
fun StepsSummary(summary: String, failed: Boolean, open: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier, glyph: @Composable () -> Unit = {}, trailing: @Composable () -> Unit = {}) {
    val colors = Oxe.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(OxeRadius.lg))
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
