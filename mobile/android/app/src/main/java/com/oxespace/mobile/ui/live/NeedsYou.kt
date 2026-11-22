package com.oxespace.mobile.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.AnswerBlock
import com.oxespace.mobile.approval.AnswerOutcome
import com.oxespace.mobile.approval.BiometricApprovalGate
import com.oxespace.mobile.approval.RequestResponder
import com.oxespace.mobile.protocol.RemoteApprovalRisk
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteThreadSummary
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.protocol.live.CommandApi
import com.oxespace.mobile.protocol.live.CommandResult
import com.oxespace.mobile.protocol.showHidden
import com.oxespace.mobile.ui.components.OxeButton
import com.oxespace.mobile.ui.components.OxeButtonKind
import com.oxespace.mobile.ui.icons.OxeIcons
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeCodeStyle
import com.oxespace.mobile.ui.theme.OxeFonts
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

/*
 * 1.5.2 Celular A7 (OXE-134, BRD-24): the "Precisa de você" queue. Each card's one signal is its header strip; a
 * permission is answered on the card through the Request screen's own RequestResponder and BiometricApprovalGate, a
 * question opens its conversation, and a critical request only offers Review (the hold lives on the Request screen).
 * Test: NeedsYouRowTest.
 */

private const val PROVIDER_LIMIT = 40
private const val TEXT_LIMIT = 200

/** The lines after which the card's buttons stay on: nothing reached the computer, so trying again is safe. */
private val RETRYABLE = setOf(R.string.request_not_confirmed, R.string.needs_you_offline)

/** What the row says after an answer: Permitido / Negado when it went through, otherwise why it did not. */
fun needsYouAnswerLine(decision: String, outcome: AnswerOutcome): Int = when (outcome) {
    is AnswerOutcome.Blocked -> when (outcome.reason) {
        AnswerBlock.DESKTOP_ONLY -> R.string.request_desktop_only
        AnswerBlock.NOT_OFFERED -> R.string.request_refused_other
        AnswerBlock.NOT_CONFIRMED -> R.string.request_not_confirmed
        AnswerBlock.TRUNCATED -> R.string.request_truncated
        AnswerBlock.IN_FLIGHT -> R.string.request_answered
        AnswerBlock.ALREADY_ANSWERED -> R.string.request_refused_not_pending
    }
    is AnswerOutcome.Sent -> when (val result = outcome.result) {
        is CommandResult.Done -> if (decision == "accept") R.string.needs_you_allowed else R.string.needs_you_denied
        CommandResult.Offline -> R.string.needs_you_offline
        CommandResult.NoAnswer -> R.string.request_refused_other
        is CommandResult.Refused -> when (result.code) {
            RemoteErrorCode.NOT_PENDING -> R.string.request_refused_not_pending
            RemoteErrorCode.STALE_GENERATION -> R.string.request_refused_stale_generation
            else -> R.string.request_refused_other
        }
    }
}

private fun answerKey(request: RemotePendingRequest) = "${request.threadId}/${request.requestId}/${request.generation}"

/** The Requests tab: its own heading, then one card per waiting request. */
@Composable
fun NeedsYouQueue(
    requests: List<RemotePendingRequest>,
    threads: List<RemoteThreadSummary>,
    online: Boolean,
    commands: CommandApi,
    onOpenThread: (String) -> Unit,
    onOpenRequest: (RemotePendingRequest) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val responder = remember(context, commands) { RequestResponder(BiometricApprovalGate(context), commands::respondRequest) }
    val lines = remember { mutableStateMapOf<String, Int>() }
    val busy = remember { mutableStateMapOf<String, Boolean>() }
    LazyColumn(modifier, contentPadding = PaddingValues(vertical = OxeSpace.space3), verticalArrangement = Arrangement.spacedBy(OxeSpace.space3)) {
        item {
            Text(
                stringResource(R.string.needs_you_title),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = OxeSpace.space4).semantics { heading() },
            )
        }
        items(requests, key = { answerKey(it) }) { request ->
            val key = answerKey(request)
            NeedsYouCard(
                request = request,
                provider = threads.firstOrNull { it.id == request.threadId }?.provider,
                online = online,
                busy = busy[key] == true,
                line = lines[key],
                onAnswer = { decision ->
                    busy[key] = true
                    scope.launch {
                        try {
                            val outcome = responder.answer(request, decision)
                            val second = outcome is AnswerOutcome.Blocked && outcome.reason == AnswerBlock.IN_FLIGHT
                            if (!second) lines[key] = needsYouAnswerLine(decision, outcome)
                        } finally {
                            busy.remove(key)
                        }
                    }
                },
                onReply = { onOpenThread(request.threadId) },
                onReview = { onOpenRequest(request) },
            )
        }
    }
}

@Composable
private fun NeedsYouCard(
    request: RemotePendingRequest,
    provider: String?,
    online: Boolean,
    busy: Boolean,
    line: Int?,
    onAnswer: (String) -> Unit,
    onReply: () -> Unit,
    onReview: () -> Unit,
) {
    val c = Oxe.colors
    val shape = RoundedCornerShape(OxeRadius.lg)
    val critical = request.risk?.let { riskLevel(it) == RemoteApprovalRisk.CRITICAL } == true
    val question = request.kind == "question" || request.kind == "elicitation"
    val canDeny = "decline" in request.decisions
    val canAllow = "accept" in request.decisions && request.truncated != true
    val answersHere = !question && !critical && request.answerable && (canDeny || canAllow)
    Column(
        Modifier.padding(horizontal = OxeSpace.space4).fillMaxWidth().clip(shape).background(c.surfaceRaised).border(1.dp, c.borderDefault, shape),
    ) {
        NeedsYouHeader(request, critical, question)
        Column(Modifier.fillMaxWidth().padding(OxeSpace.space3), verticalArrangement = Arrangement.spacedBy(OxeSpace.space3)) {
            NeedsYouSummary(request, provider, question)
            when {
                question -> OxeButton(stringResource(R.string.needs_you_reply), onClick = onReply, modifier = Modifier.fillMaxWidth(), kind = OxeButtonKind.PRIMARY)
                !answersHere -> OxeButton(stringResource(R.string.thread_review), onClick = onReview, modifier = Modifier.fillMaxWidth(), kind = OxeButtonKind.PRIMARY)
                else -> {
                    val enabled = online && !busy && (line == null || line in RETRYABLE)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                        if (canDeny) {
                            OxeButton(
                                stringResource(R.string.request_decision_decline),
                                onClick = { onAnswer("decline") },
                                modifier = Modifier.weight(1f),
                                kind = OxeButtonKind.SECONDARY,
                                enabled = enabled,
                            )
                        }
                        if (canAllow) {
                            OxeButton(
                                stringResource(R.string.request_decision_accept),
                                onClick = { onAnswer("accept") },
                                modifier = Modifier.weight(1f),
                                kind = OxeButtonKind.PRIMARY,
                                enabled = enabled,
                            )
                        }
                    }
                }
            }
            val shown = if (!answersHere) null else if (!online) R.string.needs_you_offline else line
            shown?.let {
                Text(
                    stringResource(it),
                    style = MaterialTheme.typography.bodySmall,
                    color = c.textSecondary,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}

/**
 * OXE-164 (RN-1 / RN-2): desktop-authored impact summary for a critical request, sanitized via [displaySafe] and capped
 * like a title. Never reads `request.title`, `detail`, or `reason` (agent-written text); returns null when absent or
 * blank so callers fall back to the phone's own catalog label.
 */
internal fun desktopImpactAction(request: RemotePendingRequest): String? =
    request.desktopImpactSummary?.let { displaySafe(it, TEXT_LIMIT) }?.takeIf { it.isNotEmpty() }

@Composable
internal fun criticalHeaderLabel(request: RemotePendingRequest): String {
    val action = desktopImpactAction(request) ?: stringResource(R.string.needs_you_kind_command)
    return "${stringResource(R.string.request_risk_critical)} · $action".uppercase()
}

/** The card's one signal: the sun on attn, or the alert on danger at critical, with the app's own words and the time. */
@Composable
private fun NeedsYouHeader(request: RemotePendingRequest, critical: Boolean, question: Boolean) {
    val c = Oxe.colors
    val bg = when {
        critical -> c.intentDangerBg
        else -> c.attnBg
    }
    val fg = when {
        critical -> c.intentDangerFg
        else -> c.attnFg
    }
    val icon = if (critical) OxeIcons.Warning else OxeIcons.Sun
    // OXE-164 (RN-1/RN-2): critical requests use the desktop-authored impact summary or the catalog fallback;
    // the agent's title never labels a request here (CR-F3-7).
    val kind = when {
        critical -> criticalHeaderLabel(request)
        question -> {
            val count = request.questions.orEmpty().size.coerceAtLeast(1)
            pluralStringResource(R.plurals.needs_you_kind_questions, count, count).uppercase()
        }
        request.kind == "approval" || request.command != null -> stringResource(R.string.needs_you_kind_command).uppercase()
        else -> requestTitle(request).uppercase()
    }
    Row(
        Modifier.fillMaxWidth().background(bg).padding(horizontal = OxeSpace.space3, vertical = OxeSpace.space2),
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(16.dp))
        Text(
            kind,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = OxeType.weightSemibold),
            color = fg,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text(
            needsYouTime(request.createdAt),
            style = MaterialTheme.typography.labelSmall.copy(fontFamily = OxeFonts.mono, fontFeatureSettings = "tnum"),
            color = fg,
            maxLines = 1,
        )
    }
}

/** "<agente> pede para <ação>", one TalkBack stop before the buttons. */
@Composable
private fun NeedsYouSummary(request: RemotePendingRequest, provider: String?, question: Boolean) {
    val agent = provider?.let { providerName(displaySafe(it, PROVIDER_LIMIT)) } ?: stringResource(R.string.needs_you_agent)
    val command = request.command
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(OxeSpace.space1)) {
        when {
            command != null -> {
                Text(stringResource(R.string.needs_you_asks_run, agent), style = MaterialTheme.typography.titleSmall)
                Text(showHidden(command), style = OxeCodeStyle, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            question -> {
                Text(stringResource(R.string.needs_you_asks_question, agent), style = MaterialTheme.typography.titleSmall)
                request.questions?.firstOrNull()?.let {
                    Text(displaySafe(it.question, TEXT_LIMIT), style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
            }
            else -> {
                Text(stringResource(R.string.needs_you_asks_approval, agent), style = MaterialTheme.typography.titleSmall)
                request.toolName?.let { Text(displaySafe(it, TEXT_LIMIT), style = OxeCodeStyle, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
        Text(
            displaySafe(request.threadTitle, TEXT_LIMIT),
            style = MaterialTheme.typography.labelMedium,
            color = Oxe.colors.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The header's time, short: "agora", "3 min", then the clock time. */
@Composable
private fun needsYouTime(atMs: Long): String {
    val minutes = ((LocalClock.current() - atMs) / 60_000).coerceAtLeast(0)
    return when {
        minutes < 1 -> stringResource(R.string.live_age_now)
        minutes < 60 -> stringResource(R.string.thread_extras_minutes, minutes.toString())
        else -> SimpleDateFormat("HH:mm", Locale.ROOT).format(Date(atMs))
    }
}
