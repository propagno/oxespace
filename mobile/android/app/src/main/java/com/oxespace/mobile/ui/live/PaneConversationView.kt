package com.oxespace.mobile.ui.live

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.displaySafe
import com.oxespace.mobile.protocol.live.PaneConversation
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace
import kotlinx.coroutines.launch

/**
 * CR-34 (DESIGN 08/11): the desktop hid this pane from the phone. An info Notice takes the screen's place, names the
 * computer only (never the pane), and offers one way back.
 */
@Composable
internal fun HiddenOnDesktopNotice(computer: String?, onBack: () -> Unit) {
    val name = computer ?: stringResource(R.string.home_unknown_desktop)
    Column(
        Modifier.fillMaxWidth().padding(OxeSpace.space3),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        Text(
            stringResource(R.string.terminal_hidden_on_desktop, displaySafe(name, 200)),
            color = Oxe.colors.textSecondary,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Button(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.terminal_hidden_back)) }
    }
}

/**
 * 1.5.0 A46: a terminal agent's own CLI conversation, read only. Load earlier at the top, the marker line when the
 * agent started a new conversation, follows new messages only at the bottom, a Latest chip otherwise, and the Notice
 * with Show the screen when the conversation can't be read any more.
 */
@Composable
fun PaneConversationView(conversation: PaneConversation, onShowScreen: () -> Unit, computer: String? = null, onBack: (() -> Unit)? = null) {
    val state by conversation.state.collectAsStateWithLifecycle()
    val colors = Oxe.colors
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var atBottom by remember { mutableStateOf(true) }
    LaunchedEffect(list) {
        snapshotFlow { !list.canScrollForward }.collect { bottom ->
            atBottom = bottom
            if (bottom) conversation.seen()
        }
    }
    LaunchedEffect(state.items) {
        if (conversation.follow(atBottom) && state.items.isNotEmpty()) list.scrollToItem(maxOf(0, list.layoutInfo.totalItemsCount - 1))
    }
    when {
        // CR-34: hidden is its own Notice, not "unavailable" (that one offers Show the screen, which is gone too).
        state.hiddenOnDesktop -> HiddenOnDesktopNotice(computer, onBack ?: onShowScreen)
        state.unavailable -> Column(
            Modifier.fillMaxWidth().padding(OxeSpace.space3),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            Text(
                stringResource(R.string.terminal_conversation_unavailable),
                color = colors.textSecondary,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            Button(onClick = onShowScreen, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.terminal_conversation_show_screen)) }
        }
        state.items.isEmpty() -> Text(stringResource(R.string.terminal_conversation_empty), color = colors.textSecondary, modifier = Modifier.padding(OxeSpace.space3))
        else -> Box(Modifier.fillMaxSize()) {
            LazyColumn(
                state = list,
                contentPadding = PaddingValues(OxeSpace.space3),
                verticalArrangement = Arrangement.spacedBy(OxeSpace.space2),
                modifier = Modifier.fillMaxSize(),
            ) {
                if (state.olderCursor != null) {
                    item(key = "older") {
                        TextButton(onClick = conversation::loadEarlier, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.thread_load_older)) }
                    }
                }
                if (state.newConversation) {
                    item(key = "marker") {
                        Text(stringResource(R.string.terminal_conversation_new_conversation), style = MaterialTheme.typography.labelMedium, color = colors.textMuted)
                    }
                }
                items(state.items, key = { it.id }) { item ->
                    Text(
                        item.text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (item.role == "user") colors.textSecondary else colors.textPrimary,
                    )
                }
            }
            if (!atBottom && state.newCount != 0) {
                Button(
                    onClick = {
                        scope.launch { list.scrollToItem(maxOf(0, list.layoutInfo.totalItemsCount - 1)) }
                        conversation.seen()
                    },
                    modifier = Modifier.align(Alignment.BottomCenter).padding(OxeSpace.space3).heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.thread_latest)) }
            }
        }
    }
}
