package com.oxespace.mobile.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemoteApprovalRisk
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace

/**
 * The level for a wire value, as the generated [RemoteApprovalRisk] (#368, the desktop's `APPROVAL_RISKS`): the four
 * words are read as they are. The shell colours older desktops still send map as the desktop's own `riskFromShell` does
 * (green low, orange medium, red critical), so the phone never shows a red command as anything softer. Anything else is
 * a level added later and reads as critical, the strongest badge (#354).
 */
fun riskLevel(wire: String): RemoteApprovalRisk = RemoteApprovalRisk.fromWire(wire) ?: when (wire) {
    "green" -> RemoteApprovalRisk.LOW
    "orange" -> RemoteApprovalRisk.MEDIUM
    else -> RemoteApprovalRisk.CRITICAL
}

@Composable
fun riskWord(level: RemoteApprovalRisk): String = stringResource(
    when (level) {
        RemoteApprovalRisk.LOW -> R.string.request_risk_low
        RemoteApprovalRisk.MEDIUM -> R.string.request_risk_medium
        RemoteApprovalRisk.HIGH -> R.string.request_risk_high
        RemoteApprovalRisk.CRITICAL -> R.string.request_risk_critical
    },
)

@Composable
fun riskMeaning(level: RemoteApprovalRisk): String = stringResource(
    when (level) {
        RemoteApprovalRisk.LOW -> R.string.request_risk_meaning_low
        RemoteApprovalRisk.MEDIUM -> R.string.request_risk_meaning_medium
        RemoteApprovalRisk.HIGH -> R.string.request_risk_meaning_high
        RemoteApprovalRisk.CRITICAL -> R.string.request_risk_meaning_critical
    },
)

private data class BadgeStyle(val background: Color, val border: Color, val text: Color, val bold: Boolean)

/** Glossary §6: low neutral, medium warning, high danger soft, critical danger solid, so critical never looks like high. */
@Composable
private fun badgeStyle(level: RemoteApprovalRisk): BadgeStyle = with(Oxe.colors) {
    when (level) {
        RemoteApprovalRisk.LOW -> BadgeStyle(fillHover, borderSubtle, textSecondary, bold = false)
        RemoteApprovalRisk.MEDIUM -> BadgeStyle(intentWarningBg, intentWarningBorder, intentWarningFg, bold = false)
        RemoteApprovalRisk.HIGH -> BadgeStyle(intentDangerBg, intentDangerBorder, intentDangerFg, bold = false)
        RemoteApprovalRisk.CRITICAL -> BadgeStyle(intentDangerSolid, intentDangerSolid, textOnSolid, bold = true)
    }
}

/**
 * "Risco: Alto" as a badge, then what the level means ("Apaga, eleva acesso ou publica"). Colour never carries it alone:
 * the word is in the badge, and TalkBack reads both as one sentence.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RiskLine(wire: String, modifier: Modifier = Modifier) {
    val level = riskLevel(wire)
    val badge = stringResource(R.string.request_risk_badge, riskWord(level))
    val meaning = riskMeaning(level)
    val style = badgeStyle(level)
    val spoken = "$badge. $meaning."
    FlowRow(
        modifier.clearAndSetSemantics { contentDescription = spoken },
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            badge,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (style.bold) FontWeight.Bold else null,
            color = style.text,
            modifier = Modifier
                .background(style.background, RoundedCornerShape(OxeRadius.sm))
                .border(1.dp, style.border, RoundedCornerShape(OxeRadius.sm))
                .padding(horizontal = OxeSpace.space2, vertical = 2.dp),
        )
        Text(meaning, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary)
    }
}
