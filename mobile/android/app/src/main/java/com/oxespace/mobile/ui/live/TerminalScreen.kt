package com.oxespace.mobile.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.protocol.live.CommandApi
import com.oxespace.mobile.protocol.live.CommandResult
import com.oxespace.mobile.protocol.live.TerminalBuffer
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.RemoteTerminalWriteArgs
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.Gated
import com.oxespace.mobile.approval.Presence
import com.oxespace.mobile.approval.PresenceGate
import com.oxespace.mobile.approval.PresenceReason
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.SecureScreen
import com.oxespace.mobile.ui.terminal.Ansi
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeColors
import com.oxespace.mobile.ui.theme.OxeSpace
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A pane's output, read-only, in the desktop's terminal colors; follows the newest line. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(pane: RemotePane, watched: Watched<TerminalBuffer>, commands: CommandApi, presence: PresenceGate, onBack: () -> Unit) {
    SecureScreen()
    val tick by watched.changes.collectAsStateWithLifecycle()
    val colors = Oxe.colors
    val text = remember(tick, colors) { colored(watched.store.output, colors) }
    val redacted = watched.store.redacted
    val vertical = rememberScrollState()
    LaunchedEffect(tick) { vertical.scrollTo(vertical.maxValue) }
    // The desktop's redactor holds output up to 250 ms, so a first snapshot can be empty while the pane runs:
    // say "loading" for a second before "no output yet".
    var settling by remember { mutableStateOf(true) }
    LaunchedEffect(watched.loaded) {
        if (watched.loaded) {
            delay(EMPTY_GRACE_MS)
            settling = false
        }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(pane.title, maxLines = 1, modifier = Modifier.semantics { heading() })
                        Text(
                            stringResource(if (pane.phoneWrite) R.string.live_phone_write else R.string.live_read_only),
                            style = MaterialTheme.typography.labelMedium,
                            color = Oxe.colors.textSecondary,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(ImageVector.vectorResource(R.drawable.ic_back), contentDescription = stringResource(R.string.live_back)) }
                },
            )
        },
        bottomBar = { if (pane.phoneWrite) TerminalInput(pane.id, commands, presence) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).background(colors.surfaceSunken)) {
            if (redacted > 0) {
                Text(
                    pluralStringResource(R.plurals.terminal_redacted, redacted.toInt(), redacted.toInt()),
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.textMuted,
                    modifier = Modifier.padding(horizontal = OxeSpace.space3, vertical = OxeSpace.space2),
                )
            }
            if (text.isEmpty()) {
                Text(stringResource(if (watched.loaded && !settling) R.string.terminal_empty else R.string.live_loading), color = colors.textSecondary, modifier = Modifier.padding(OxeSpace.space3))
            } else {
                Text(
                    text,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    color = colors.textPrimary,
                    softWrap = false,
                    modifier = Modifier.verticalScroll(vertical).horizontalScroll(rememberScrollState()).padding(OxeSpace.space3),
                )
            }
        }
    }
}

/** ANSI colors 0–15 from the desktop's terminal tokens, so the phone shows the palette the person knows. */
private fun ansiColor(colors: OxeColors, index: Int): Color = when (index) {
    0 -> colors.ansiBlack
    1 -> colors.ansiRed
    2 -> colors.ansiGreen
    3 -> colors.ansiYellow
    4 -> colors.ansiBlue
    5 -> colors.ansiMagenta
    6 -> colors.ansiCyan
    7 -> colors.ansiWhite
    8 -> colors.ansiBrightBlack
    9 -> colors.ansiBrightRed
    10 -> colors.ansiBrightGreen
    11 -> colors.ansiBrightYellow
    12 -> colors.ansiBrightBlue
    13 -> colors.ansiBrightMagenta
    14 -> colors.ansiBrightCyan
    else -> colors.ansiBrightWhite
}

private fun colored(output: String, colors: OxeColors): AnnotatedString = buildAnnotatedString {
    for (span in Ansi.parse(output)) {
        val color = span.color?.let { ansiColor(colors, it) } ?: Color.Unspecified
        withStyle(SpanStyle(color = color, fontWeight = if (span.bold) FontWeight.Bold else null)) { append(span.text) }
    }
}

/**
 * Typing into a pane the person allowed from the phone, at the desktop. The line goes with Enter, in pieces of at most
 * 4 KiB; a refusal (the desktop turned typing off meanwhile) says so and keeps the text.
 */
@Composable
private fun TerminalInput(paneId: String, commands: CommandApi, presence: PresenceGate) {
    val scope = rememberCoroutineScope()
    // Opening a terminal the phone can type into asks right away (MB-M-01); inside the window nothing is shown.
    var unlocked by remember(paneId) { mutableStateOf(if (presence.windowOpen()) Presence.CONFIRMED else null) }
    LaunchedEffect(paneId) { if (unlocked != Presence.CONFIRMED) unlocked = presence.confirm(PresenceReason.TYPE) }
    if (unlocked != Presence.CONFIRMED) {
        LockedInput(unlocked) { scope.launch { unlocked = presence.confirm(PresenceReason.TYPE) } }
        return
    }
    var text by rememberSaveable(paneId) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Int?>(null) }
    Column(
        Modifier.fillMaxWidth().background(Oxe.colors.surfaceChrome).navigationBarsPadding().imePadding().padding(OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        message?.let { Text(stringResource(it), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.intentWarningFg, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; message = null },
                placeholder = { Text(stringResource(R.string.terminal_input_placeholder)) },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = {
                    busy = true
                    scope.launch {
                        val pieces = terminalPieces(text)
                        var sent = 0
                        val gated = presence.run(PresenceReason.TYPE) {
                            var result: CommandResult = CommandResult.Done(null)
                            for (piece in pieces) {
                                result = commands.terminalWrite(RemoteTerminalWriteArgs(paneId, piece))
                                if (result !is CommandResult.Done) break
                                sent++
                            }
                            result
                        }
                        when (gated) {
                            // The window closed meanwhile and the person didn't open it again: the text stays.
                            is Gated.Blocked -> message = presenceMessage(gated.reason)
                            is Gated.Done -> {
                                message = commandMessage(gated.value)
                                // What went through is in the terminal already: only the rest stays, so sending again can't repeat it.
                                text = unsentText(pieces, sent)
                            }
                        }
                        busy = false
                    }
                },
                enabled = !busy && text.isNotEmpty(),
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.terminal_input_send)) }
        }
    }
}

/** In place of the input until the person proves it's them: why, and a button to try again. */
@Composable
private fun LockedInput(presence: Presence?, onConfirm: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Oxe.colors.surfaceChrome).navigationBarsPadding().imePadding().padding(OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        val why = if (presence == Presence.NO_SCREEN_LOCK) R.string.presence_no_screen_lock else R.string.presence_locked
        Text(stringResource(why), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.intentWarningFg, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        // While the first prompt is up there is nothing to press; without a screen lock pressing would change nothing.
        if (presence == Presence.NOT_CONFIRMED) {
            Button(onClick = onConfirm, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.presence_confirm)) }
        }
    }
}

/** How long an empty first snapshot reads as "loading": the redactor delays output up to 250 ms. */
private const val EMPTY_GRACE_MS = 1_000L

/** Characters per terminal.write; ASCII-heavy input keeps it under the contract's 4 KiB. */
private const val TERMINAL_PIECE = 1_000

/** What the Enter key sends to a terminal. */
private const val ENTER = "\r"

/** A typed line as terminal.write pieces, Enter included. */
internal fun terminalPieces(text: String): List<String> = (text + ENTER).chunked(TERMINAL_PIECE)

/** What's left to type after [sent] pieces went through; empty when all did. Enter is the send button's, not the field's. */
internal fun unsentText(pieces: List<String>, sent: Int): String = pieces.drop(sent).joinToString("").removeSuffix(ENTER)

