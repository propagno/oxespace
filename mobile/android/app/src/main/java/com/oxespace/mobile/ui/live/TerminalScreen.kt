package com.oxespace.mobile.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.live.TerminalBuffer
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.terminal.Ansi
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeColors
import com.oxespace.mobile.ui.theme.OxeSpace

/** A pane's output, read-only, in the desktop's terminal colors; follows the newest line. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(pane: RemotePane, watched: Watched<TerminalBuffer>, onBack: () -> Unit) {
    val tick by watched.changes.collectAsStateWithLifecycle()
    val colors = Oxe.colors
    val text = remember(tick, colors) { colored(watched.store.output, colors) }
    val redacted = watched.store.redacted
    val vertical = rememberScrollState()
    LaunchedEffect(tick) { vertical.scrollTo(vertical.maxValue) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(pane.title, maxLines = 1)
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
                Text(stringResource(if (watched.loaded) R.string.terminal_empty else R.string.live_loading), color = colors.textSecondary, modifier = Modifier.padding(OxeSpace.space3))
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
