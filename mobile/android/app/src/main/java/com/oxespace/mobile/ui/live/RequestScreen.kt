package com.oxespace.mobile.ui.live

import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.RadioButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.oxespace.mobile.ui.theme.OxeCodeStyle
import kotlinx.coroutines.delay
import com.oxespace.mobile.ui.theme.OxeFonts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
fun RequestScreen(
    request: RemotePendingRequest?,
    commands: CommandApi,
    /** The conversation's provider, for "Pedido por: Claude · …". */
    provider: String? = null,
    /** The workspace's name, shown for a request at the project root instead of ".". */
    workspaceName: String? = null,
    onBack: () -> Unit,
) {
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
            Text(requestTitle(request), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
            request.risk?.let { RiskLine(it) }
            // The facts, as label/value rows: nothing read-only looks like an input (M10 §6).
            Facts(
                listOfNotNull(
                    Triple(stringResource(R.string.request_by), listOfNotNull(provider?.let { providerName(displaySafe(it, PROVIDER_MAX)) }, displaySafe(request.threadTitle, TITLE_MAX)).joinToString(" · "), false),
                    request.cwd?.let { cwd ->
                        // The project root reads as the project's name, never ".".
                        if (cwd == "." || cwd.isBlank()) {
                            Triple(stringResource(R.string.request_where), workspaceName?.let { displaySafe(it, TITLE_MAX) } ?: stringResource(R.string.request_project_folder), false)
                        } else {
                            Triple(stringResource(R.string.request_where), showHidden(cwd), true)
                        }
                    },
                    request.toolName?.let { Triple(stringResource(R.string.request_tool), displaySafe(it, TITLE_MAX), false) },
                ),
            )
            // What would run is shown whole; hidden characters are written out, never dropped or obeyed.
            request.command?.let { CodeBlock(showHidden(it)) }
            request.paths?.takeIf { it.isNotEmpty() }?.let {
                Text(stringResource(R.string.request_paths), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted)
                CodeBlock(it.joinToString("\n") { p -> showHidden(p) })
            }
            // The app's notes, in its own voice, above the agent's words.
            val notes = request.warnings.orEmpty().map { displaySafeBlock(it, RemoteTextLimits.DETAIL) } +
                listOfNotNull(request.redacted?.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.terminal_redacted, it.toInt(), it.toInt()) })
            if (notes.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(OxeSpace.space1)) {
                    for (note in notes) Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                        Text("•", style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textSecondary)
                        Text(note, style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textSecondary)
                    }
                }
            }
            // The agent's own words come last, in a dashed box the app has not vouched for.
            val detail = request.detail?.let { displaySafeBlock(it, RemoteTextLimits.DETAIL) }?.takeIf { it.isNotEmpty() }
            val why = request.reason?.let { displaySafeBlock(it, RemoteTextLimits.DETAIL) }?.takeIf { it.isNotEmpty() }
            // The request's own title is never the heading: it is the agent's, so it sits here.
            val own = displaySafe(request.title, TITLE_MAX).takeIf { it.isNotBlank() }
            if (own != null || detail != null || why != null) AgentWords(listOfNotNull(own, detail).joinToString("\n").ifEmpty { null }, why)

            if (!request.answerable) return@Column

            val questions = request.questions.orEmpty()
            for (question in questions) {
                Text(displaySafe(question.header ?: question.question, QUESTION_MAX), style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
                if (question.header != null) Text(displaySafeBlock(question.question, QUESTION_MAX), style = MaterialTheme.typography.bodyMedium)
                val single = question.multiple != true
                // Single choice: full-width radio rows in one group (§3a); several: checkboxes. None looks like a form field.
                Column(Modifier.then(if (single) Modifier.selectableGroup() else Modifier), verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                    for (option in question.options.orEmpty()) {
                        val picked = option.label in chosen[question.id].orEmpty()
                        val pick = { on: Boolean ->
                            val now = chosen[question.id].orEmpty()
                            chosen[question.id] = when {
                                !single -> if (on) now + option.label else now - option.label
                                on -> setOf(option.label)
                                else -> emptySet()
                            }
                        }
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = Target)
                                .background(if (picked) Oxe.colors.accentSoft else Oxe.colors.surfaceRaised, RoundedCornerShape(OxeRadius.lg))
                                .border(1.dp, if (picked) Oxe.colors.accent else Oxe.colors.borderDefault, RoundedCornerShape(OxeRadius.lg))
                                .then(
                                    if (single) Modifier.selectable(selected = picked, role = Role.RadioButton) { pick(true) }
                                    else Modifier.toggleable(value = picked, role = Role.Checkbox) { pick(it) },
                                )
                                .padding(OxeSpace.space3),
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3),
                        ) {
                            if (single) RadioButton(selected = picked, onClick = null) else Checkbox(checked = picked, onCheckedChange = null)
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

            // The only box on the screen that looks editable.
            if ("decline" in request.decisions) {
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it.take(500) },
                    label = { Text(stringResource(R.string.request_decline_reason)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            // At critical risk Allow waits the desktop's hold before it can be pressed (APPROVAL_CRITICAL_ALLOW_DELAY_MS).
            val critical = request.risk?.let { riskLevel(it) } == RiskLevel.CRITICAL
            // Keyed on the generation and the level too: a request raised to critical takes the hold again.
            var held by remember(request.requestId, request.generation, critical) { mutableStateOf(critical) }
            LaunchedEffect(request.requestId, request.generation, critical) { if (critical) { delay(CRITICAL_HOLD_MS); held = false } }
            for ((decision, leads) in decisionLayout(request.decisions, request.risk)) {
                val label = stringResource(
                    when (decision) {
                        "accept" -> R.string.request_decision_accept
                        "decline" -> R.string.request_decision_decline
                        else -> R.string.request_decision_cancel
                    },
                )
                val enabled = !busy && !(decision == "accept" && held)
                // The lead is the accent's filled button; Deny is never danger red: it is the safe answer (§6).
                if (leads) {
                    Button(onClick = { answer(decision, null) }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = Target)) { Text(label) }
                } else {
                    OutlinedButton(onClick = { answer(decision, null) }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = Target)) { Text(label) }
                }
            }
            if ("accept" in request.decisions) {
                Text(
                    stringResource(if (held) R.string.request_hold else R.string.request_allow_biometric),
                    style = MaterialTheme.typography.bodySmall,
                    color = Oxe.colors.textMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
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
    val lead = if (risk != null && riskLevel(risk) == RiskLevel.LOW) "accept" else "decline"
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


/** Label/value rows (§6): the label muted, the value plain; a path in Plex Mono, cut in the middle. */
@Composable
private fun Facts(rows: List<Triple<String, String, Boolean>>) {
    Column(verticalArrangement = Arrangement.spacedBy(OxeSpace.space1)) {
        for ((label, value, mono) in rows) {
            Row(Modifier.semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3)) {
                Text(label, style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textMuted)
                Text(
                    value,
                    style = if (mono) OxeCodeStyle else MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.MiddleEllipsis,
                )
            }
        }
    }
}

/** "Escrito pelo agente": a dashed box that opens with "O OXESpace não verificou este texto." (§6). */
@Composable
private fun AgentWords(detail: String?, why: String?) {
    val dash = Oxe.colors.borderDefault
    Text(stringResource(R.string.request_from_agent), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted, modifier = Modifier.semantics { heading() })
    Column(
        Modifier.fillMaxWidth()
            .drawBehind {
                val stroke = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())))
                drawRoundRect(dash, cornerRadius = CornerRadius(10.dp.toPx()), style = stroke)
            }
            .padding(horizontal = OxeSpace.space3, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        Text(stringResource(R.string.request_not_verified), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted)
        detail?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        why?.let {
            Text(stringResource(R.string.request_reason), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textMuted)
            Text(it, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * A pending request's title, from the phone's own catalog by its kind (TECH LEAD R1 v2, DESIGN option b): never the
 * agent's text, which only shows inside "Escrito pelo agente". A kind this app doesn't know reads as an agent's request.
 */
internal fun requestTitleString(kind: String): Int = when (kind) {
    "question", "elicitation" -> R.string.request_kind_question
    "permissions" -> R.string.request_kind_permissions
    else -> R.string.request_kind_agent
}

@Composable
fun requestTitle(request: RemotePendingRequest): String =
    stringResource(requestTitleString(request.kind))

private val KNOWN_DECISIONS = setOf("accept", "decline", "cancel")
private const val TITLE_MAX = 200
private const val QUESTION_MAX = 500
private const val PROVIDER_MAX = 40
/** The desktop's hold on Allow at critical risk (shared/types/approvals APPROVAL_CRITICAL_ALLOW_DELAY_MS). */
private const val CRITICAL_HOLD_MS = 2_000L
