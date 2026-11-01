package com.oxespace.mobile.ui.live

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import android.content.ClipData
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.Gated
import com.oxespace.mobile.approval.PresenceGate
import com.oxespace.mobile.approval.PresenceReason
import com.oxespace.mobile.protocol.RemoteLimits
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteTextLimits
import com.oxespace.mobile.protocol.RemoteThreadHistoryArgs
import com.oxespace.mobile.protocol.RemoteThreadInterruptArgs
import com.oxespace.mobile.protocol.RemoteThreadItem
import com.oxespace.mobile.protocol.RemoteThreadSendArgs
import com.oxespace.mobile.protocol.RemoteThreadSteerArgs
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.protocol.displaySafeBlock
import com.oxespace.mobile.protocol.showHidden
import com.oxespace.mobile.protocol.live.CommandApi
import com.oxespace.mobile.protocol.live.CommandResult
import com.oxespace.mobile.protocol.live.ThreadTimeline
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeCodeStyle
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * One conversation, in Mandacaru (docs/design/mobile-conversation.md): the person's prompts as sunken blocks, the
 * agent's prose as plain text, steps as rows, the turn's final message as its one card, the running state live, the
 * waiting request docked above a one-button composer.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadScreen(
    threadId: String,
    watched: Watched<ThreadTimeline>,
    commands: CommandApi,
    presence: PresenceGate,
    connected: Boolean,
    /** The conversation's name from the lists, shown while the stream loads (never "Carregando…"). */
    knownTitle: String? = null,
    /** The requests waiting in this conversation, from the desktop's pending list. */
    pending: List<RemotePendingRequest> = emptyList(),
    onOpenRequest: (requestId: String) -> Unit = {},
    /** Before this the previous screen stays (motion.md); screenshots pass 0. */
    skeletonAfterMs: Long = SKELETON_DELAY_MS,
    onBack: () -> Unit,
) {
    val tick by watched.changes.collectAsStateWithLifecycle()
    val timeline = watched.store
    val header = timeline.header
    val entries = remember(tick) { timeline.items }
    val running = header?.status == "running"
    var openTurns by rememberSaveable(threadId) { mutableStateOf(setOf<String>()) }
    val rows = remember(tick, openTurns, running) { timelineRows(entries.map { it.item }, running, openTurns) }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var loadingOlder by remember { mutableStateOf(false) }
    var stopping by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Int?>(null) }
    // Follow the newest row while the person is at the bottom.
    LaunchedEffect(rows.size) {
        if (rows.isNotEmpty() && (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 3) {
            list.animateScrollToItem(list.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1)
        }
    }
    if (stopping) {
        StopTurnDialog(
            title = displaySafe(header?.title ?: knownTitle.orEmpty(), TITLE_MAX),
            onConfirm = {
                stopping = false
                scope.launch { message = commandMessage(commands.interrupt(RemoteThreadInterruptArgs(threadId))) }
            },
            onDismiss = { stopping = false },
        )
    }
    val title = (header?.title ?: knownTitle)?.let { displaySafe(it, TITLE_MAX) }
    Scaffold(
        containerColor = Oxe.colors.surfaceCanvas,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title.orEmpty(), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                        header?.let { StateLine(it.status, it.updatedAt, it.provider) }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(ImageVector.vectorResource(R.drawable.ic_back), contentDescription = stringResource(R.string.live_back)) }
                },
                actions = {
                    if (running) {
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(ImageVector.vectorResource(R.drawable.ic_more), contentDescription = stringResource(R.string.live_menu)) }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(text = { Text(stringResource(R.string.thread_stop_turn)) }, enabled = connected, onClick = { menu = false; stopping = true })
                            }
                        }
                    }
                },
            )
        },
        bottomBar = {
            Column(Modifier.background(Oxe.colors.surfaceCanvas).navigationBarsPadding().imePadding().padding(horizontal = OxeSpace.space3, vertical = OxeSpace.space2), verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                message?.let { Text(stringResource(it), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.intentWarningFg, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                pending.firstOrNull()?.let { RequestBar(it, more = pending.size - 1, enabled = connected) { onOpenRequest(it.requestId) } }
                Composer(
                    threadId = threadId,
                    running = running,
                    canSteer = header?.canSteer == true,
                    connected = connected,
                    enabled = watched.loaded,
                    commands = commands,
                    presence = presence,
                    onStop = { stopping = true },
                )
            }
        },
    ) { padding ->
        if (!watched.loaded) {
            ConversationSkeleton(Modifier.padding(padding), skeletonAfterMs)
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            state = list,
            contentPadding = PaddingValues(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space3),
        ) {
            if (timeline.hasMore && entries.isNotEmpty()) {
                item(key = "older") {
                    TextButton(
                        enabled = !loadingOlder,
                        onClick = {
                            loadingOlder = true
                            scope.launch {
                                val result = commands.history(RemoteThreadHistoryArgs(threadId, entries.first().seq))
                                if (result is CommandResult.Done) result.result?.let { page -> watched.update { it.prepend(page) } }
                                loadingOlder = false
                            }
                        },
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.thread_load_older)) }
                }
            }
            if (timeline.skipped > 0) {
                item(key = "skipped") { Text(pluralStringResource(R.plurals.thread_unknown_items, timeline.skipped, timeline.skipped), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted) }
            }
            items(rows, key = { it.key }) { row ->
                when (row) {
                    is TimelineRow.Prompt -> PromptBlock(row.text, row.truncated)
                    is TimelineRow.Prose -> MarkdownText(displaySafeBlock(row.text, RemoteTextLimits.ITEM_TEXT), truncated = row.truncated)
                    is TimelineRow.Answer -> AnswerCard(row.text, row.truncated)
                    is TimelineRow.Step -> StepRow(row.tool)
                    is TimelineRow.StepGroup -> StepGroupRow(row.tools)
                    is TimelineRow.Plan -> PlanBlock(row.plan)
                    is TimelineRow.RequestMarker -> RequestMarker(row.request)
                    is TimelineRow.TurnBar -> TurnBar(row) { openTurns = if (row.open) openTurns - row.turnId else openTurns + row.turnId }
                    is TimelineRow.Running -> RunningRows(row)
                    is TimelineRow.Subagents -> Text("${toolStateLabel(row.item.state)} · ${row.item.agents}", style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textSecondary)
                }
            }
        }
    }
}

// ---- app bar ---------------------------------------------------------------------------------------------------------

/** The state dot (pulsing while working), the state word, then "· há 2 min · Claude". */
@Composable
private fun StateLine(status: String, updatedAt: Long, provider: String) {
    val (word, color) = threadState(status)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        StateDot(color, pulsing = status == "running")
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = Oxe.colors.textPrimary, fontWeight = FontWeight.Medium)) { append(stringResource(word)) }
                withStyle(SpanStyle(color = Oxe.colors.textMuted)) { append(" · ${ageLabel(updatedAt)} · ${providerName(displaySafe(provider, PROVIDER_MAX))}") }
            },
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun threadState(status: String): Pair<Int, Color> = with(Oxe.colors) {
    when (status) {
        "running" -> R.string.thread_state_working to accent
        "approval" -> R.string.thread_state_needs_you to intentWarningFg
        "failed" -> R.string.thread_state_failed to intentDangerFg
        "interrupted" -> R.string.thread_state_stopped to textMuted
        else -> R.string.thread_state_idle to textMuted
    }
}

/** 8 dp; pulses with the desktop's `oxe-pulse` while working, and stands still with reduced motion. */
@Composable
private fun StateDot(color: Color, pulsing: Boolean) {
    val pulse = Oxe.motion.durationPulse
    val alpha = if (pulsing && pulse > 0) {
        val transition = rememberInfiniteTransition(label = "pulse")
        transition.animateFloat(1f, 0.45f, infiniteRepeatable(tween(pulse / 2), RepeatMode.Reverse), label = "alpha").value
    } else {
        1f
    }
    Box(Modifier.size(8.dp).alpha(alpha).background(color, CircleShape))
}

// ---- timeline rows ---------------------------------------------------------------------------------------------------

/** The person's prompt: a sunken block, the same fill in light and dark; TalkBack hears "Você: …". */
@Composable
private fun PromptBlock(text: String, truncated: Boolean) {
    val shown = displaySafeBlock(text, RemoteTextLimits.ITEM_TEXT)
    val spoken = stringResource(R.string.thread_you_said, shown)
    Column(
        Modifier.fillMaxWidth().background(promptFill(), RoundedCornerShape(OxeRadius.lg))
            .padding(horizontal = OxeSpace.space3, vertical = 10.dp)
            .clearAndSetSemantics { contentDescription = spoken },
    ) {
        Text(shown, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold))
        if (truncated) Text(stringResource(R.string.thread_truncated), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted)
    }
}

/**
 * The prompt's fill: the text colour over the canvas, as the desktop's `.thread-message-user`, so it reads as a sunken
 * block in both themes (the exported dark `surfaceSunken` is almost the canvas itself).
 */
@Composable
private fun promptFill(): Color = lerp(Oxe.colors.surfaceCanvas, Oxe.colors.textPrimary, PROMPT_TINT)

/** The turn's one card: raised, "Resposta do agente" in the accent text, Markdown with copyable code blocks. */
@Composable
private fun AnswerCard(text: String, truncated: Boolean) {
    Column(
        Modifier.fillMaxWidth()
            .background(Oxe.colors.surfaceRaised, RoundedCornerShape(OxeRadius.lg))
            .border(1.dp, Oxe.colors.borderSubtle, RoundedCornerShape(OxeRadius.lg))
            .padding(horizontal = OxeSpace.space3, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(stringResource(R.string.thread_answer_label), style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textAccent)
        MarkdownText(displaySafeBlock(text, RemoteTextLimits.ITEM_TEXT), truncated = truncated)
    }
}

/** The agent's Markdown (Markdown.kt): paragraphs, lists and code blocks. */
@Composable
private fun MarkdownText(text: String, truncated: Boolean) {
    val blocks = remember(text) { parseMarkdown(text) }
    Column(verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
        for (block in blocks) {
            when (block) {
                is MdBlock.Paragraph -> Text(spans(block.spans), style = MaterialTheme.typography.bodyLarge)
                is MdBlock.Bullet -> Row(horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                    Text(block.marker, style = MaterialTheme.typography.bodyLarge, color = Oxe.colors.textSecondary)
                    Text(spans(block.spans), style = MaterialTheme.typography.bodyLarge)
                }
                is MdBlock.Code -> CodeBlock(block.text)
            }
        }
        if (truncated) Text(stringResource(R.string.thread_truncated), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted)
    }
}

@Composable
private fun spans(spans: List<MdSpan>): AnnotatedString {
    val code = SpanStyle(fontFamily = OxeCodeStyle.fontFamily, fontSize = OxeCodeStyle.fontSize, background = Oxe.colors.surfaceSunken)
    return buildAnnotatedString {
        for (span in spans) {
            when (span) {
                is MdSpan.Plain -> append(span.text)
                is MdSpan.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(span.text) }
                is MdSpan.Code -> withStyle(code) { append(span.text) }
            }
        }
    }
}

/** A code block: sunken, Plex Mono, scrolls sideways inside itself, with Copiar at the top right. */
@Composable
fun CodeBlock(text: String) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember(text) { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(COPIED_MS); copied = false } }
    Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).background(promptFill(), RoundedCornerShape(OxeRadius.md))) {
        Text(
            text,
            style = OxeCodeStyle,
            softWrap = false,
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 10.dp, end = 76.dp, top = 14.dp, bottom = 14.dp),
        )
        TextButton(
            onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("code", text))) }; copied = true },
            modifier = Modifier.align(Alignment.TopEnd).heightIn(min = 48.dp),
        ) { Text(stringResource(if (copied) R.string.thread_copied else R.string.thread_copy), style = MaterialTheme.typography.labelMedium) }
    }
}

/** One step: status icon, verb, the target in Plex Mono, a muted count, and a chevron that opens its output. */
@Composable
private fun StepRow(tool: RemoteThreadItem.Tool, indent: Boolean = false) {
    var open by rememberSaveable(tool.id) { mutableStateOf(false) }
    val output = tool.output?.takeIf { it.isNotEmpty() }
    val kind = stepKind(tool.name)
    val count = tool.filesChanged?.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.thread_files_changed, it.toInt(), it.toInt()) }
    Column {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 40.dp)
                .then(if (output != null) Modifier.clickable(role = Role.Button) { open = !open }.semantics { stateDescription = if (open) "expanded" else "collapsed" } else Modifier)
                .padding(start = if (indent) 26.dp else 0.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            StepIcon(tool.state)
            Text(
                buildAnnotatedString {
                    append(stringResource(verbRes(kind)))
                    append(' ')
                    withStyle(SpanStyle(fontFamily = OxeCodeStyle.fontFamily, color = Oxe.colors.textPrimary)) {
                        append(displaySafe(if (kind == StepKind.OTHER) "${tool.name} ${tool.detail}" else tool.detail, TARGET_MAX))
                    }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Oxe.colors.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis,
                modifier = Modifier.weight(1f),
            )
            count?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted) }
            if (output != null) Chevron(open)
        }
        tool.redacted?.takeIf { it > 0 }?.let {
            Text(pluralStringResource(R.plurals.terminal_redacted, it.toInt(), it.toInt()), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted, modifier = Modifier.padding(start = 26.dp))
        }
        // What is shown is what Copiar copies: hidden characters written out, never obeyed.
        if (open && output != null) Box(Modifier.padding(start = 26.dp)) { CodeBlock(showHidden(output)) }
    }
}

/** Consecutive steps in one row ("Leu 3 arquivos · executou 2 comandos"); opens to the individual rows. */
@Composable
private fun StepGroupRow(tools: List<RemoteThreadItem.Tool>) {
    var open by rememberSaveable(tools.first().id) { mutableStateOf(false) }
    val parts = groupCounts(tools).map { (kind, n) -> pluralStringResource(groupRes(kind), n, n) }
    val summary = parts.joinToString(" · ").replaceFirstChar { it.titlecase() }
    Column {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 40.dp).clickable(role = Role.Button) { open = !open }
                .semantics { stateDescription = if (open) "expanded" else "collapsed" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            StepIcon(if (tools.any { it.state == "failed" }) "failed" else "completed")
            Text(summary, style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textSecondary, modifier = Modifier.weight(1f))
            Chevron(open)
        }
        if (open) tools.forEach { StepRow(it, indent = true) }
    }
}

@Composable
private fun StepIcon(state: String) {
    Box(Modifier.width(18.dp), contentAlignment = Alignment.Center) {
        when (state) {
            "running" -> Spinner()
            "failed" -> Text("✕", color = Oxe.colors.intentDangerFg, fontWeight = FontWeight.Bold)
            "completed" -> Text("✓", color = Oxe.colors.intentSuccessFg, fontWeight = FontWeight.Bold)
            else -> Text("·", color = Oxe.colors.textMuted)
        }
    }
}

@Composable
private fun Spinner() {
    CircularProgressIndicator(Modifier.size(14.dp).semantics { hideFromAccessibility() }, color = Oxe.colors.accent, trackColor = Oxe.colors.borderSubtle, strokeWidth = 2.dp)
}

@Composable
private fun Chevron(open: Boolean) {
    Icon(ImageVector.vectorResource(R.drawable.ic_chevron), contentDescription = null, tint = Oxe.colors.textMuted, modifier = Modifier.size(20.dp).rotate(if (open) 90f else 0f))
}

/** The plan: one raised block, "Plano · 1 de 3", done steps muted and struck through, the current one at 600. */
@Composable
private fun PlanBlock(plan: RemoteThreadItem.Plan) {
    val done = plan.steps.count { it.status == "completed" }
    Column(
        Modifier.fillMaxWidth().background(Oxe.colors.surfaceRaised, RoundedCornerShape(OxeRadius.lg))
            .border(1.dp, Oxe.colors.borderSubtle, RoundedCornerShape(OxeRadius.lg)).padding(horizontal = OxeSpace.space3, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        Text(stringResource(R.string.thread_plan_progress, done, plan.steps.size), style = MaterialTheme.typography.titleSmall, color = Oxe.colors.textSecondary, modifier = Modifier.semantics { heading() })
        for (step in plan.steps) {
            val label = displaySafe(step.label, TARGET_MAX)
            when (step.status) {
                "completed" -> Text(label, style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textMuted, textDecoration = TextDecoration.LineThrough)
                "inProgress" -> Text(label, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                else -> Text(label, style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textSecondary)
            }
        }
    }
}

/** Where a request happened: a small pill; the request itself waits in the bar above the composer. */
@Composable
private fun RequestMarker(request: RemoteThreadItem.Request) {
    val waiting = request.state == "pending"
    val text = stringResource(
        when (request.state) {
            "pending" -> R.string.thread_marker_pending
            "resolved" -> R.string.thread_marker_resolved
            "cancelled" -> R.string.thread_marker_cancelled
            else -> R.string.thread_marker_expired
        },
    )
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Text(
            text,
            style = MaterialTheme.typography.labelMedium,
            color = if (waiting) Oxe.colors.intentWarningFg else Oxe.colors.textMuted,
            modifier = Modifier.background(if (waiting) Oxe.colors.intentWarningBg else Oxe.colors.surfaceSunken, RoundedCornerShape(50)).padding(horizontal = OxeSpace.space3, vertical = 3.dp),
        )
    }
}

/** A finished turn's bar: "Trabalhou · 7 passos" (the time joins it when C5 sends it); opens that turn's steps. */
@Composable
private fun TurnBar(row: TimelineRow.TurnBar, onToggle: () -> Unit) {
    val steps = pluralStringResource(R.plurals.thread_steps, row.steps, row.steps)
    val label = stringResource(
        when (row.status) {
            "failed" -> R.string.thread_turn_failed
            "interrupted" -> R.string.thread_turn_interrupted
            else -> R.string.thread_turn_completed
        },
        steps,
    )
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).clickable(role = Role.Button, onClick = onToggle)
            .semantics { stateDescription = if (row.open) "expanded" else "collapsed" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted, modifier = Modifier.weight(1f))
        Chevron(row.open)
    }
}

/** While the agent works: the live row (what is happening now), then the turn's bar with its step count. */
@Composable
private fun RunningRows(row: TimelineRow.Running) {
    val now = row.current?.let { tool ->
        val kind = stepKind(tool.name)
        stringResource(doingRes(kind), displaySafe(if (kind == StepKind.OTHER) tool.name else tool.detail, TARGET_MAX))
    } ?: stringResource(R.string.thread_analyzing)
    Column(verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
        Row(
            Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(18.dp), contentAlignment = Alignment.Center) { Spinner() }
            Text(now, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text(
            stringResource(R.string.thread_turn_working, pluralStringResource(R.plurals.thread_steps, row.steps, row.steps)),
            style = MaterialTheme.typography.bodySmall,
            color = Oxe.colors.textMuted,
        )
    }
}

// ---- the request bar and the composer --------------------------------------------------------------------------------

/** The waiting request, docked above the composer (§4): risk badge and its one-liner, the title, Responder. */
@Composable
private fun RequestBar(request: RemotePendingRequest, more: Int, enabled: Boolean, onRespond: () -> Unit) {
    Column(
        Modifier.fillMaxWidth()
            .background(Oxe.colors.surfaceRaised, RoundedCornerShape(14.dp))
            .border(1.dp, Oxe.colors.borderSubtle, RoundedCornerShape(14.dp))
            .padding(horizontal = OxeSpace.space3, vertical = 10.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space1),
    ) {
        request.risk?.let { RiskLine(it) }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
            Column(Modifier.weight(1f)) {
                val suffix = if (more > 0) " " + pluralStringResource(R.plurals.thread_more_requests, more, more) else ""
                Text(requestTitle(request) + suffix, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                if (!request.answerable) Text(stringResource(R.string.thread_answer_on_computer), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.textMuted)
            }
            if (request.answerable) {
                Button(onClick = onRespond, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.thread_respond)) }
            }
        }
    }
}

/**
 * One raised container with the field and one trailing button (§5): Enviar when idle; while the agent works, Parar
 * (a square) with an empty field and Orientar (or Enviar, queued) once text is typed. A message keeps its clientId
 * while its fate is unknown, so sending it again after a silent drop can't make it arrive twice; after a refusal the
 * next try is a new message. The text stays until it's sent.
 */
@Composable
private fun Composer(
    threadId: String,
    running: Boolean,
    canSteer: Boolean,
    connected: Boolean,
    enabled: Boolean,
    commands: CommandApi,
    presence: PresenceGate,
    onStop: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var text by rememberSaveable(threadId) { mutableStateOf("") }
    var clientId by rememberSaveable(threadId) { mutableStateOf(UUID.randomUUID().toString()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Int?>(null) }
    var unsentText by rememberSaveable(threadId) { mutableStateOf<String?>(null) }
    var unsentSteer by rememberSaveable(threadId) { mutableStateOf(false) }
    val unsent = unsentText?.let { Outgoing(it, unsentSteer) }
    val steer = running && canSteer

    /** [ask] false for the resend after a reconnection: inside the window it goes, outside it waits for a tap on Send. */
    suspend fun send(outgoing: Outgoing, ask: Boolean = true) {
        busy = true
        val gated = presence.run(PresenceReason.SEND, ask) {
            if (outgoing.steer) commands.steer(RemoteThreadSteerArgs(threadId, outgoing.text, clientId))
            else commands.send(RemoteThreadSendArgs(threadId, outgoing.text, clientId))
        }
        when (gated) {
            is Gated.Blocked -> message = presenceMessage(gated.reason)
            is Gated.Done -> {
                val result = gated.value
                message = commandMessage(result)
                val waiting = result == CommandResult.NoAnswer || result == CommandResult.Offline
                unsentText = if (waiting) outgoing.text else null
                unsentSteer = outgoing.steer
                if (result is CommandResult.Done) text = ""
                clientId = clientIdAfter(result, clientId) { UUID.randomUUID().toString() }
            }
        }
        busy = false
    }

    LaunchedEffect(connected) {
        if (connected && !busy) resendOf(unsent, text)?.let { send(it, ask = false) }
    }
    val typed = text.isNotBlank()
    Column(verticalArrangement = Arrangement.spacedBy(OxeSpace.space1)) {
        message?.let { Text(stringResource(it), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.intentWarningFg, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .background(Oxe.colors.surfaceRaised, RoundedCornerShape(24.dp))
                .border(BorderStroke(1.dp, Oxe.colors.borderDefault), RoundedCornerShape(24.dp))
                .padding(start = OxeSpace.space4, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            val placeholder = stringResource(R.string.composer_placeholder)
            BasicTextField(
                value = text,
                onValueChange = { value ->
                    text = value.take(RemoteLimits.MAX_TEXT_LENGTH)
                    message = null
                    // An edit of an unsent message is a new message: it never goes by itself, and it gets its own clientId.
                    if (unsentText != null && text != unsentText) {
                        unsentText = null
                        clientId = UUID.randomUUID().toString()
                    }
                },
                enabled = enabled,
                maxLines = 5,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = Oxe.colors.textPrimary),
                cursorBrush = SolidColor(Oxe.colors.accent),
                modifier = Modifier.weight(1f).padding(vertical = OxeSpace.space2).semantics { contentDescription = placeholder },
                decorationBox = { field ->
                    Box {
                        if (text.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = Oxe.colors.textMuted)
                        field()
                    }
                },
            )
            when {
                running && !typed -> FilledIconButton(
                    onClick = onStop,
                    enabled = connected && enabled,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = Oxe.colors.accent, contentColor = Oxe.colors.textOnAccent),
                    modifier = Modifier.size(40.dp),
                ) { Icon(ImageVector.vectorResource(R.drawable.ic_stop), contentDescription = stringResource(R.string.thread_stop_turn)) }
                running && steer -> Button(
                    onClick = { scope.launch { send(outgoingFor(unsent, text, steer)) } },
                    enabled = !busy && enabled,
                    modifier = Modifier.heightIn(min = 40.dp),
                ) { Text(stringResource(R.string.composer_steer)) }
                else -> FilledIconButton(
                    onClick = { scope.launch { send(outgoingFor(unsent, text, steer)) } },
                    enabled = !busy && typed && enabled,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = Oxe.colors.accent, contentColor = Oxe.colors.textOnAccent),
                    modifier = Modifier.size(40.dp),
                ) { Icon(ImageVector.vectorResource(R.drawable.ic_send), contentDescription = stringResource(R.string.composer_send)) }
            }
        }
    }
}

@Composable
private fun StopTurnDialog(title: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.thread_stop_title)) },
        text = { Text(stringResource(R.string.thread_stop_body, title)) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(stringResource(R.string.thread_stop_confirm)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.thread_stop_keep)) } },
    )
}

// ---- loading ---------------------------------------------------------------------------------------------------------

/** The OxeChat skeleton (§7): a prompt block and four prose lines; TalkBack hears "Carregando a conversa" once. */
@Composable
private fun ConversationSkeleton(modifier: Modifier, afterMs: Long) {
    val spoken = stringResource(R.string.thread_loading)
    var shown by remember { mutableStateOf(afterMs <= 0) }
    LaunchedEffect(Unit) { delay(afterMs); shown = true }
    Column(
        modifier.fillMaxSize().padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3).clearAndSetSemantics { contentDescription = spoken },
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space3),
    ) {
        if (!shown) return@Column
        Box(Modifier.fillMaxWidth().height(56.dp).background(promptFill(), RoundedCornerShape(OxeRadius.lg)))
        for (fraction in listOf(0.95f, 0.85f, 0.9f, 0.6f)) {
            Box(Modifier.fillMaxWidth(fraction).height(14.dp).background(promptFill(), RoundedCornerShape(OxeRadius.sm)))
        }
        Spacer(Modifier.weight(1f))
    }
}

// ---- words -----------------------------------------------------------------------------------------------------------

private fun verbRes(kind: StepKind) = when (kind) {
    StepKind.READ -> R.string.thread_verb_read
    StepKind.RUN -> R.string.thread_verb_run
    StepKind.EDIT -> R.string.thread_verb_edit
    StepKind.CREATE -> R.string.thread_verb_create
    StepKind.SEARCH -> R.string.thread_verb_search
    StepKind.OTHER -> R.string.thread_verb_other
}

private fun doingRes(kind: StepKind) = when (kind) {
    StepKind.READ -> R.string.thread_doing_read
    StepKind.RUN -> R.string.thread_doing_run
    StepKind.EDIT -> R.string.thread_doing_edit
    StepKind.CREATE -> R.string.thread_doing_create
    StepKind.SEARCH -> R.string.thread_doing_search
    StepKind.OTHER -> R.string.thread_doing_other
}

private fun groupRes(kind: StepKind) = when (kind) {
    StepKind.READ -> R.plurals.thread_group_read
    StepKind.RUN -> R.plurals.thread_group_run
    StepKind.SEARCH -> R.plurals.thread_group_search
    else -> R.plurals.thread_group_other
}

private const val TITLE_MAX = 200
private const val TARGET_MAX = 160
private const val COPIED_MS = 2_000L
private const val SKELETON_DELAY_MS = 300L
private const val PROMPT_TINT = 0.06f
private const val PROVIDER_MAX = 40
