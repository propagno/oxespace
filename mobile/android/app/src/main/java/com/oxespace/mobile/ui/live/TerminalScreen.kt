package com.oxespace.mobile.ui.live

import com.oxespace.mobile.ui.components.Segmented
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.drawWithContent
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
import com.oxespace.mobile.ui.components.Notice
import com.oxespace.mobile.ui.components.NoticeAction
import com.oxespace.mobile.ui.components.NoticeIntent
import com.oxespace.mobile.ui.components.OxeButton
import com.oxespace.mobile.ui.components.OxeButtonKind
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
import com.oxespace.mobile.protocol.live.PaneConversation
import com.oxespace.mobile.protocol.live.showsConversationToggle
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
fun TerminalScreen(pane: RemotePane, watched: Watched<TerminalBuffer>, commands: CommandApi, presence: PresenceGate, conversation: PaneConversation? = null, computer: String? = null, onBack: () -> Unit) {
    SecureScreen()
    val tick by watched.changes.collectAsStateWithLifecycle()
    // CR-34: the desktop hid this pane from the phone; nothing of it stays, the title and last frame included.
    // The conversation can be ended as hidden on its own stream; either one hides the whole pane.
    val conversationHidden = conversation?.let { it.state.collectAsStateWithLifecycle().value.hiddenOnDesktop } ?: false
    val hidden = remember(tick) { watched.store.hiddenOnDesktop } || conversationHidden
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
    // A46: Screen · Conversation, only when the desktop says the pane's agent has a conversation; it opens on
    // Conversation (DESIGN M6.11), read only.
    val offersConversation = conversation != null && showsConversationToggle(pane)
    var showingConversation by rememberSaveable(pane.id) { mutableStateOf(true) }
    val reading = offersConversation && showingConversation
    // Each view keeps its own scroll while the terminal is open: both list states live here, not in the views.
    val conversationList = rememberLazyListState()
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
                    if (!hidden) Column {
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
                    if (!hidden) Box {
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
        bottomBar = { if (pane.phoneWrite && !hidden && !reading) TerminalInput(pane.id, commands, presence) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).background(colors.surfaceSunken)) {
            if (hidden) {
                HiddenOnDesktopNotice(computer, onBack)
                return@Column
            }
            if (offersConversation) {
                Row(Modifier.padding(horizontal = OxeSpace.space3), horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2), verticalAlignment = Alignment.CenterVertically) {
                    // CR-A42b-2 (M6): the View is a segmented row, Screen · Conversation.
                    Segmented(
                        options = listOf(stringResource(R.string.terminal_conversation_screen), stringResource(R.string.terminal_conversation_conversation)),
                        selected = if (showingConversation) 1 else 0,
                        onSelect = { showingConversation = it == 1 },
                        modifier = Modifier.weight(1f).padding(vertical = OxeSpace.space2),
                    )
                }
                if (showingConversation) {
                    Text(
                        stringResource(R.string.terminal_conversation_caption, displaySafe(pane.agent ?: pane.title, 200)),
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.textMuted,
                        modifier = Modifier.padding(horizontal = OxeSpace.space3),
                    )
                    // Read only: no input here; typing goes on the Screen view.
                    Text(
                        stringResource(R.string.terminal_type_on_screen),
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.textSecondary,
                        modifier = Modifier.padding(horizontal = OxeSpace.space3, vertical = OxeSpace.space1),
                    )
                }
            }
            val shownConversation = conversation?.takeIf { reading }
            if (shownConversation != null) {
                PaneConversationView(shownConversation, onShowScreen = { showingConversation = false }, computer = computer, onBack = onBack, list = conversationList)
            } else if (redacted > 0) {
                Text(
                    pluralStringResource(R.plurals.terminal_redacted, redacted.toInt(), redacted.toInt()),
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.textMuted,
                    modifier = Modifier.padding(horizontal = OxeSpace.space3, vertical = OxeSpace.space2),
                )
            }
            if (reading) {
                // The conversation view above takes the space.
            } else if (lines.all { it.text.isEmpty() }) {
                Text(stringResource(if (watched.loaded && !settling) R.string.terminal_empty else R.string.live_loading), color = colors.textSecondary, modifier = Modifier.padding(OxeSpace.space3))
            } else {
                TerminalLines(lines, watched.store.cols, list, size.sp.sp, colors)
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
private fun TerminalLines(lines: List<VtLine>, cols: Int?, list: LazyListState, fontSize: TextUnit, colors: OxeColors) {
    val base = TextStyle(fontFamily = OxeFonts.mono, fontSize = fontSize, color = colors.textPrimary)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val charWidth = remember(fontSize, density) { measurer.measure("0", base).size.width }
    // A45: with the desktop's width known the grid is exactly that wide and pans sideways on a narrow phone;
    // without it (an older desktop) it is as wide as the longest line, as in 1.4.3.
    val longest = remember(lines, cols) { cols ?: (lines.maxOfOrNull { it.text.length } ?: 0) }
    val padding = OxeSpace.space3
    // CR-A45 (T-P3.1): nothing is clipped silently. A grid wider than the view says it pans, and offers to fit the width.
    var fit by rememberSaveable { mutableStateOf(false) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val view = maxWidth
        val grid = with(density) { (charWidth * longest).toDp() }
        val wider = grid + padding * 2 > view
        val fitted = fit && wider && grid.value > 0f
        val scale = if (fitted) ((view - padding * 2) / grid).coerceIn(0.1f, 1f) else 1f
        val style = if (fitted) base.copy(fontSize = fontSize * scale) else base
        val content = if (fitted) view else grid + padding * 2
        Column(Modifier.fillMaxSize()) {
            if (wider) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = OxeSpace.space3),
                    horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (fitted) "" else stringResource(R.string.terminal_pan_hint, longest.toString()),
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.textMuted,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { fit = !fit }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.terminal_fit_width), color = if (fitted) colors.textPrimary else colors.textMuted)
                    }
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth().then(if (fitted) Modifier else Modifier.horizontalScroll(rememberScrollState()))) {
                LazyColumn(
                    state = list,
                    contentPadding = PaddingValues(padding),
                    modifier = Modifier.fillMaxHeight().width(maxOf(content, view)),
                ) {
                    items(lines.size) { index ->
                        val line = lines[index]
                        Text(remember(line, colors) { colored(line, colors) }, style = style, softWrap = false, maxLines = 1)
                    }
                }
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
        message?.let { Notice(NoticeIntent.WARNING, title = stringResource(it), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
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
            OxeButton(
                stringResource(R.string.terminal_input_send),
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
            )
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
        // While the first prompt is up there is nothing to press; without a screen lock pressing would change nothing.
        val confirm = stringResource(R.string.presence_confirm)
        Notice(
            NoticeIntent.WARNING,
            title = stringResource(why),
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            actions = if (presence == Presence.NOT_CONFIRMED) listOf(NoticeAction(confirm, onConfirm)) else emptyList(),
        )
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
    // CR-A42b-2 (DESIGN #744): SECONDARY 48 dp keys with Plex Mono labels (terminal = mono), and an edge fade on each
    // side the row can still scroll to, so a cut key never looks like the last one.
    val scroll = rememberScrollState()
    val chrome = Oxe.colors.surfaceChrome
    Box(
        Modifier.fillMaxWidth().drawWithContent {
            drawContent()
            val fade = 24.dp.toPx()
            val clear = chrome.copy(alpha = 0f)
            if (scroll.value > 0) {
                drawRect(Brush.horizontalGradient(listOf(chrome, clear), startX = 0f, endX = fade), size = Size(fade, size.height))
            }
            if (scroll.value < scroll.maxValue) {
                drawRect(
                    Brush.horizontalGradient(listOf(clear, chrome), startX = size.width - fade, endX = size.width),
                    topLeft = Offset(size.width - fade, 0f),
                    size = Size(fade, size.height),
                )
            }
        },
    ) {
        Row(Modifier.fillMaxWidth().horizontalScroll(scroll), horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
            for (key in TerminalKey.entries) {
                val spoken = keyName(key)?.let { stringResource(it) }
                OxeButton(
                    key.label,
                    onClick = { onKey(key) },
                    enabled = enabled,
                    kind = OxeButtonKind.SECONDARY,
                    fontFamily = OxeFonts.mono,
                    modifier = if (spoken != null) Modifier.semantics { contentDescription = spoken } else Modifier,
                )
            }
            OxeButton(stringResource(R.string.terminal_paste), onClick = onPaste, kind = OxeButtonKind.SECONDARY)
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
