package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.RemoteApprovalRisk
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.AnswerBlock
import com.oxespace.mobile.approval.AnswerOutcome
import com.oxespace.mobile.approval.BiometricApprovalGate
import com.oxespace.mobile.approval.RequestResponder
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteTextLimits
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.protocol.displaySafeBlock
import com.oxespace.mobile.protocol.showHidden
import com.oxespace.mobile.protocol.live.CommandApi
import com.oxespace.mobile.ui.SecureScreen
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import kotlinx.coroutines.launch

private val Target = 48.dp

/**
 * A request waiting for the person, shown whole before any answer: what runs, where, which files, the risk colour
 * and the warnings the desktop shows. Every answer asks for biometrics or the device credential first.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RequestScreen(request: RemotePendingRequest?, commands: CommandApi, onBack: () -> Unit) {
    SecureScreen()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val responder = remember(context, commands) { RequestResponder(BiometricApprovalGate(context), commands::respondRequest) }
    var message by rememberSaveable { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var reason by rememberSaveable { mutableStateOf("") }
    val chosen = remember { mutableStateMapOf<String, Set<String>>() }

    fun answer(decision: String?, answers: Map<String, List<String>>?) {
        val current = request ?: return
        busy = true
        scope.launch {
            message = when (val outcome = responder.answer(current, decision, answers, reason.takeIf { decision == "decline" })) {
                is AnswerOutcome.Blocked -> when (outcome.reason) {
                    AnswerBlock.DESKTOP_ONLY -> R.string.request_desktop_only
                    AnswerBlock.NOT_OFFERED -> R.string.request_refused_other
                    AnswerBlock.NOT_CONFIRMED -> R.string.request_not_confirmed
                    AnswerBlock.TRUNCATED -> R.string.request_truncated
                }
                is AnswerOutcome.Sent -> answerMessage(outcome.result)
            }
            busy = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.request_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(ImageVector.vectorResource(R.drawable.ic_back), contentDescription = stringResource(R.string.live_back)) } },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(OxeSpace.space4),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space3),
        ) {
            message?.let { Text(stringResource(it), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            if (request == null) {
                if (message == null) Text(stringResource(R.string.request_gone), style = MaterialTheme.typography.bodyLarge)
                return@Column
            }
            // What the person needs first: whether they can answer here at all.
            if (!request.answerable) DesktopOnlyNotice()
            Text(displaySafe(request.title, TITLE_MAX), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
            Text(stringResource(R.string.request_from, displaySafe(request.threadTitle, TITLE_MAX)), style = MaterialTheme.typography.labelLarge, color = Oxe.colors.textSecondary)
            request.risk?.let { RiskLine(it) }
            request.toolName?.let { Field(stringResource(R.string.request_tool), displaySafe(it, TITLE_MAX), mono = false) }
            // What would run is shown whole; hidden characters are written out, never dropped or obeyed.
            request.command?.let { Field(stringResource(R.string.request_command), showHidden(it), mono = true) }
            request.cwd?.let { Field(stringResource(R.string.request_cwd), showHidden(it), mono = true) }
            request.paths?.takeIf { it.isNotEmpty() }?.let { Field(stringResource(R.string.request_paths), it.joinToString("\n") { p -> showHidden(p) }, mono = true) }
            request.warnings?.takeIf { it.isNotEmpty() }?.let {
                Field(stringResource(R.string.request_warnings), it.joinToString("\n") { w -> "• " + displaySafeBlock(w, RemoteTextLimits.DETAIL) }, mono = false)
            }
            request.redacted?.takeIf { it > 0 }?.let {
                Text(androidx.compose.ui.res.pluralStringResource(R.plurals.terminal_redacted, it.toInt(), it.toInt()), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted)
            }
            // The agent's own words come last, under their own label and on an outlined field, so none of them reads
            // as the app's (or as the desktop's warnings above).
            val detail = request.detail?.let { displaySafeBlock(it, RemoteTextLimits.DETAIL) }?.takeIf { it.isNotEmpty() }
            val why = request.reason?.let { displaySafeBlock(it, RemoteTextLimits.DETAIL) }?.takeIf { it.isNotEmpty() }
            if (detail != null || why != null) {
                FromAgentLabel()
                detail?.let { Field(null, it, mono = false, fromAgent = true) }
                why?.let { Field(stringResource(R.string.request_reason), it, mono = false, fromAgent = true) }
            }

            val truncated = request.truncated == true
            if (truncated) {
                Text(
                    stringResource(if (request.kind == "question") R.string.request_truncated_question else R.string.request_truncated),
                    style = MaterialTheme.typography.bodyLarge,
                    color = Oxe.colors.intentWarningFg,
                )
            }
            // A truncated question is answered on the desktop only: nothing to pick or send here.
            if (!request.answerable || (truncated && request.kind == "question")) return@Column

            val questions = if (truncated) emptyList() else request.questions.orEmpty()
            // Never an approval for what the phone wasn't shown in full, even if the desktop offered one.
            val decisions = if (truncated) request.decisions.filter { it == "decline" || it == "cancel" } else request.decisions
            if (questions.isNotEmpty() && detail == null && why == null) FromAgentLabel()
            for (question in questions) {
                Text(displaySafe(question.header ?: question.question, QUESTION_MAX), style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
                if (question.header != null) Text(displaySafeBlock(question.question, QUESTION_MAX), style = MaterialTheme.typography.bodyMedium)
                for (option in question.options.orEmpty()) {
                    val picked = option.label in chosen[question.id].orEmpty()
                    Column(
                        Modifier.fillMaxWidth().heightIn(min = Target).toggleable(value = picked, role = Role.Checkbox) { on ->
                            val now = chosen[question.id].orEmpty()
                            chosen[question.id] = when {
                                question.multiple == true -> if (on) now + option.label else now - option.label
                                on -> setOf(option.label)
                                else -> emptySet()
                            }
                        },
                    ) {
                        androidx.compose.foundation.layout.Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            Checkbox(checked = picked, onCheckedChange = null)
                            Column {
                                Text(displaySafe(option.label, TITLE_MAX), style = MaterialTheme.typography.bodyLarge)
                                option.description?.let { Text(displaySafe(it, QUESTION_MAX), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textSecondary) }
                            }
                        }
                    }
                }
            }
            if (questions.isNotEmpty()) {
                val complete = questions.all { question -> question.required != true || chosen[question.id].orEmpty().isNotEmpty() }
                Button(
                    onClick = { answer(null, chosen.mapValues { it.value.toList() }.filterValues { it.isNotEmpty() }) },
                    enabled = !busy && complete,
                    modifier = Modifier.fillMaxWidth().heightIn(min = Target),
                ) { Text(stringResource(R.string.request_send_answers)) }
            }

            if ("decline" in decisions) {
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it.take(500) },
                    label = { Text(stringResource(R.string.request_decline_reason)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            for ((decision, leads) in decisionLayout(decisions, request.risk)) {
                val label = stringResource(
                    when (decision) {
                        "accept" -> R.string.request_decision_accept
                        "decline" -> R.string.request_decision_decline
                        else -> R.string.request_decision_cancel
                    },
                )
                if (leads) {
                    Button(
                        onClick = { answer(decision, null) },
                        enabled = !busy,
                        colors = if (decision == "decline") {
                            ButtonDefaults.buttonColors(containerColor = Oxe.colors.intentDangerSolid, contentColor = Oxe.colors.textOnSolid)
                        } else {
                            ButtonDefaults.buttonColors()
                        },
                        modifier = Modifier.fillMaxWidth().heightIn(min = Target),
                    ) { Text(label) }
                } else {
                    OutlinedButton(
                        onClick = { answer(decision, null) },
                        enabled = !busy,
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = if (decision == "decline") Oxe.colors.intentDangerFg else MaterialTheme.colorScheme.primary),
                        modifier = Modifier.fillMaxWidth().heightIn(min = Target),
                    ) { Text(label) }
                }
            }
        }
    }
}

/**
 * The order and emphasis of the answers (P1, as the desktop's modal since #243): on anything but a read-only request,
 * Deny comes first and is the filled button, so a hurried tap denies; Allow is outlined and still needs biometrics.
 * A request without a risk, or with a level added later, counts as risky. Cancel always comes last. Only the three
 * answers the phone knows are ever shown: a decision added to the protocol later is left to the computer rather than
 * drawn under a wrong label.
 */
internal fun decisionLayout(decisions: List<String>, risk: String?): List<Pair<String, Boolean>> {
    val lead = if (risk != null && riskLevel(risk) == RemoteApprovalRisk.LOW) "accept" else "decline"
    return decisions
        .filter { it in KNOWN_DECISIONS }
        .sortedBy { when (it) { lead -> 0; "cancel" -> 2; else -> 1 } }
        .map { it to (it == lead) }
}

/** On top of a request only the computer can answer: the person learns it before reading the details. */
@Composable
private fun DesktopOnlyNotice() {
    Column(
        Modifier.fillMaxWidth()
            .background(Oxe.colors.intentWarningBg, RoundedCornerShape(OxeRadius.md))
            .border(1.dp, Oxe.colors.intentWarningBorder, RoundedCornerShape(OxeRadius.md))
            .padding(OxeSpace.space3)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        Text(stringResource(R.string.request_desktop_only_title), style = MaterialTheme.typography.titleSmall, color = Oxe.colors.intentWarningFg)
        Text(stringResource(R.string.request_desktop_only), style = MaterialTheme.typography.bodyMedium)
    }
}


@Composable
private fun Field(label: String?, value: String, mono: Boolean, fromAgent: Boolean = false) {
    // Read as one: "Command, rm -rf dist build".
    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(OxeSpace.space1)) {
        label?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary) }
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = if (mono) FontFamily.Monospace else null,
            // The app's facts sit on a filled field; the agent's own words on an outlined one, never looking like the app's.
            modifier = if (fromAgent) {
                Modifier.fillMaxWidth().border(1.dp, Oxe.colors.borderDefault, RoundedCornerShape(OxeRadius.sm)).padding(OxeSpace.space2)
            } else {
                Modifier.fillMaxWidth().background(Oxe.colors.surfaceSunken, RoundedCornerShape(OxeRadius.sm)).padding(OxeSpace.space2)
            },
        )
    }
}

/** "Escrito pelo agente": what follows is the agent's, not OXESpace's. */
@Composable
private fun FromAgentLabel() {
    HorizontalDivider(color = Oxe.colors.borderSubtle)
    Text(stringResource(R.string.request_from_agent), style = MaterialTheme.typography.labelSmall, color = Oxe.colors.textMuted)
}

private val KNOWN_DECISIONS = setOf("accept", "decline", "cancel")
private const val TITLE_MAX = 200
private const val QUESTION_MAX = 500
