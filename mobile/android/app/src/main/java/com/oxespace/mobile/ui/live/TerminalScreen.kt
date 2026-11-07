package com.oxespace.mobile.ui.live

import androidx.compose.material3.AlertDialog
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.clearAndSetSemantics
import com.oxespace.mobile.protocol.displaySafe
import androidx.core.content.edit
import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import com.oxespace.mobile.ui.theme.OxeFonts
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.protocol.live.CommandApi
import com.oxespace.mobile.protocol.live.CommandResult
import com.oxespace.mobile.protocol.live.TerminalBuffer
import com.oxespace.mobile.protocol.live.VtLine
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.TextUnit
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.RemoteTerminalWriteArgs
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.Gated
import com.oxespace.mobile.approval.Presence
import com.oxespace.mobile.approval.PresenceGate
import com.oxespace.mobile.approval.PresenceReason
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.SecureScreen
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
    // The screen, not the raw stream (T97): unchanged lines come back as the same objects, so the list skips them.
    val lines = remember(tick) { watched.store.lines() }
    val redacted = watched.store.redacted
    val list = rememberLazyListState()
    // Follow the newest line only while the person is at the bottom. Scrolling up to read stops it; back at the
    // bottom, it starts again.
    var follow by remember { mutableStateOf(true) }
    LaunchedEffect(list) {
        snapshotFlow { list.isScrollInProgress }.collect { scrolling -> if (!scrolling) follow = !list.canScrollForward }
    }
    LaunchedEffect(tick) { if (follow && lines.isNotEmpty()) list.scrollToItem(lines.lastIndex) }
    // The desktop's redactor holds output up to 250 ms, so a first snapshot can be empty while the pane runs:
    // say "loading" for a second before "no output yet".
    var settling by remember { mutableStateOf(true) }
    val context = LocalContext.current
    var size by remember { mutableStateOf(terminalTextSize(readTextSize(context))) }
    var sizeMenu by remember { mutableStateOf(false) }
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
                        Text(displaySafe(pane.title, 200), style = MaterialTheme.typography.titleMedium, maxLines = 1, modifier = Modifier.semantics { heading() })
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
                actions = {
                    Box {
                        val label = stringResource(R.string.terminal_text_size)
                        TextButton(
                            onClick = { sizeMenu = true },
                            modifier = Modifier.heightIn(min = 48.dp).clearAndSetSemantics { contentDescription = label; role = Role.Button; onClick { sizeMenu = true; true } },
                        ) { Text("Aa") }
                        DropdownMenu(expanded = sizeMenu, onDismissRequest = { sizeMenu = false }) {
                            for (option in TerminalTextSize.entries) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(sizeLabel(option))) },
                                    leadingIcon = { RadioButton(selected = option == size, onClick = null) },
                                    onClick = { size = option; writeTextSize(context, option); sizeMenu = false },
                                )
                            }
                        }
                    }
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
            if (lines.all { it.text.isEmpty() }) {
                Text(stringResource(if (watched.loaded && !settling) R.string.terminal_empty else R.string.live_loading), color = colors.textSecondary, modifier = Modifier.padding(OxeSpace.space3))
            } else {
                TerminalLines(lines, list, size.sp.sp, colors)
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

/**
 * The screen's lines, only the visible ones composed (a long session stays cheap). The lines don't wrap: the list is
 * as wide as the longest line in the monospaced font, and scrolls sideways inside the screen.
 */
@Composable
private fun TerminalLines(lines: List<VtLine>, list: LazyListState, fontSize: TextUnit, colors: OxeColors) {
    val style = TextStyle(fontFamily = OxeFonts.mono, fontSize = fontSize, color = colors.textPrimary)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val charWidth = remember(fontSize, density) { measurer.measure("0", style).size.width }
    val longest = remember(lines) { lines.maxOfOrNull { it.text.length } ?: 0 }
    val padding = OxeSpace.space3
    BoxWithConstraints(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
        val content = with(density) { (charWidth * longest).toDp() } + padding * 2
        LazyColumn(
            state = list,
            contentPadding = PaddingValues(padding),
            modifier = Modifier.fillMaxHeight().width(maxOf(content, maxWidth)),
        ) {
            items(lines.size) { index ->
                val line = lines[index]
                Text(remember(line, colors) { colored(line, colors) }, style = style, softWrap = false, maxLines = 1)
            }
        }
    }
}

internal fun colored(line: VtLine, colors: OxeColors): AnnotatedString = buildAnnotatedString {
    append(line.text)
    for (run in line.runs) {
        if (run.color == null && !run.bold) continue
        addStyle(SpanStyle(color = run.color?.let { ansiColor(colors, it) } ?: Color.Unspecified, fontWeight = if (run.bold) FontWeight.Bold else null), run.start, run.end)
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
    val context = LocalContext.current
    var message by remember { mutableStateOf<Int?>(null) }
    var askLines by remember { mutableStateOf(0) }

    fun sendLine() {
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
    }

    if (askLines > 0) {
        AlertDialog(
            onDismissRequest = { askLines = 0 },
            text = { Text(pluralStringResource(R.plurals.terminal_paste_lines, askLines, askLines)) },
            confirmButton = { TextButton(onClick = { askLines = 0; sendLine() }) { Text(stringResource(R.string.terminal_input_send)) } },
            dismissButton = { TextButton(onClick = { askLines = 0 }) { Text(stringResource(R.string.terminal_cancel)) } },
        )
    }
    Column(
        Modifier.fillMaxWidth().background(Oxe.colors.surfaceChrome).navigationBarsPadding().imePadding().padding(OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        message?.let { Text(stringResource(it), style = MaterialTheme.typography.bodySmall, color = Oxe.colors.intentWarningFg, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        val clipboard = LocalClipboard.current
        KeyRow(
            enabled = !busy,
            onKey = { key ->
                busy = true
                scope.launch {
                    when (val gated = presence.run(PresenceReason.TYPE) { commands.terminalWrite(RemoteTerminalWriteArgs(paneId, key.bytes)) }) {
                        is Gated.Blocked -> message = presenceMessage(gated.reason)
                        is Gated.Done -> message = commandMessage(gated.value)
                    }
                    busy = false
                }
            },
            // Colar puts the clipboard in the field, so the person sees it before it goes.
            onPaste = {
                scope.launch {
                    val pasted = clipboard.getClipEntry()?.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
                    if (!pasted.isNullOrEmpty()) text += pasted
                }
            },
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; message = null },
                placeholder = { Text(stringResource(R.string.terminal_input_placeholder)) },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = OxeFonts.mono),
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = {
                    // SECURITY #386: hidden characters are shown, not sent; several lines ask first. This covers Colar and
                    // the keyboard's own paste alike.
                    when (val check = lineCheck(text)) {
                        is LineCheck.Hidden -> { text = check.shown; message = R.string.terminal_hidden_shown }
                        is LineCheck.Lines -> askLines = check.count
                        LineCheck.Clear -> sendLine()
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

/** Esc, Tab, ⇧Tab, Ctrl+C, the arrows and Colar: the keys a phone keyboard lacks (M11), 48 dp each, scrolling sideways. */
@Composable
private fun KeyRow(enabled: Boolean, onKey: (TerminalKey) -> Unit, onPaste: () -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
        for (key in TerminalKey.entries) {
            val spoken = keyName(key)?.let { stringResource(it) }
            OutlinedButton(
                onClick = { onKey(key) },
                enabled = enabled,
                contentPadding = PaddingValues(horizontal = OxeSpace.space3),
                modifier = Modifier.heightIn(min = 48.dp).then(if (spoken != null) Modifier.semantics { contentDescription = spoken } else Modifier),
            ) { Text(key.label, fontFamily = OxeFonts.mono) }
        }
        OutlinedButton(onClick = onPaste, contentPadding = PaddingValues(horizontal = OxeSpace.space3), modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.terminal_paste))
        }
    }
}

private fun keyName(key: TerminalKey): Int? = when (key) {
    TerminalKey.UP -> R.string.terminal_key_up
    TerminalKey.DOWN -> R.string.terminal_key_down
    TerminalKey.LEFT -> R.string.terminal_key_left
    TerminalKey.RIGHT -> R.string.terminal_key_right
    else -> null
}

private fun sizeLabel(size: TerminalTextSize): Int = when (size) {
    TerminalTextSize.SMALL -> R.string.terminal_size_small
    TerminalTextSize.MEDIUM -> R.string.terminal_size_medium
    TerminalTextSize.LARGE -> R.string.terminal_size_large
}

/** The terminal's text size lives on the phone only; screenshots and a failed read get the default. */
private fun readTextSize(context: Context): String? =
    runCatching { context.getSharedPreferences(TERMINAL_PREFS, Context.MODE_PRIVATE).getString(TEXT_SIZE_KEY, null) }.getOrNull()

private fun writeTextSize(context: Context, size: TerminalTextSize) {
    runCatching { context.getSharedPreferences(TERMINAL_PREFS, Context.MODE_PRIVATE).edit { putString(TEXT_SIZE_KEY, size.name) } }
}

private const val TERMINAL_PREFS = "terminal"
private const val TEXT_SIZE_KEY = "textSize"
