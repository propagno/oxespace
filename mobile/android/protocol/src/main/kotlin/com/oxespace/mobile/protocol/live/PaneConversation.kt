package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.RemotePaneConversationEvent
import com.oxespace.mobile.protocol.RemotePaneConversationPage
import com.oxespace.mobile.protocol.RemoteThreadItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement

/*
 * 1.5.0 F10 A46 (phone side) and CR-34 (HML-F10-1): a terminal agent's own CLI conversation, read only.
 * CCRs: docs/roadmap-1.5/ccr-phone-pane-conversation.md (#658), ccr-phone-terminal.md (#691) T-P3.3.
 * Tests: PaneConversationTest, PaneHiddenTest, androidTest PaneConversationOnDeviceTest.
 */

/** One text message of a pane agent's conversation; `id` is stable (`native:<uuid>`), the merge key. */
data class ConversationItem(val id: String, val role: String, val text: String)

/** A page, oldest to newest; [cursor] for "Load earlier", null at the oldest; [epoch] bumps on a new session. */
data class ConversationPage(val items: List<ConversationItem>, val cursor: String?, val epoch: Long)

/** What a `pane.conversation` fetch gave. */
sealed interface ConversationFetch {
    data class Page(val page: ConversationPage) : ConversationFetch
    /** `conversation-changed`, with its reason (`new-session`, `rewritten`, or one added later). */
    data class Changed(val reason: String?) : ConversationFetch
    data object NoConversation : ConversationFetch
}

data class PaneConversationState(
    val items: List<ConversationItem> = emptyList(),
    val olderCursor: String? = null,
    /** The marker line "The agent started a new conversation" goes above [items]. */
    val newConversation: Boolean = false,
    /** The Notice: the conversation can't be read any more; the screen is still live. */
    val unavailable: Boolean = false,
    /** The Latest chip's count; null after a gap (no overlap, or a new epoch). */
    val newCount: Int? = 0,
    /** CR-34: the desktop hid this pane from the phone. */
    val hiddenOnDesktop: Boolean = false,
)

/**
 * A pane agent's conversation on the phone: merge by id, Load earlier, coalesced fetches, follow at the bottom.
 * Thread-safe: the connection delivers snapshots and changes while the screen asks for older pages.
 */
class PaneConversation(private val scope: CoroutineScope, private val fetch: suspend (cursor: String?) -> ConversationFetch) {
    private val lock = Any()
    private val current = MutableStateFlow(PaneConversationState())
    val state: StateFlow<PaneConversationState> = current.asStateFlow()

    /** The session the held items belong to; null until the first page. */
    private var epoch: Long? = null
    private var refreshing = false
    /** A change arrived while a fetch was in flight: one more, never more than one. */
    private var again = false
    private var loadingEarlier = false
    private var hidden = false

    /** The stream's snapshot: the newest page, merged when it continues what the phone holds. */
    fun onSnapshot(page: ConversationPage) {
        synchronized(lock) {
            if (hidden) return
            applyNewest(page, Mode.MERGE)
        }
    }

    /** A `changed` event: read the newest page again, at most one fetch in flight and one queued. */
    fun onChanged() {
        synchronized(lock) {
            if (hidden) return
            if (refreshing) {
                again = true
                return
            }
            refreshing = true
        }
        scope.launch {
            try {
                while (true) {
                    handle(fetch(null)) { applyNewest(it, Mode.MERGE) }
                    val more = synchronized(lock) {
                        if (again && !hidden) {
                            again = false
                            true
                        } else {
                            again = false
                            refreshing = false
                            false
                        }
                    }
                    if (!more) break
                }
            } catch (failure: Throwable) {
                synchronized(lock) {
                    again = false
                    refreshing = false
                }
                throw failure
            }
        }
    }

    /** The page before the oldest held one; nothing at the oldest or while one is loading. */
    fun loadEarlier() {
        val cursor = synchronized(lock) {
            val cursor = current.value.olderCursor
            if (hidden || loadingEarlier || cursor == null) return
            loadingEarlier = true
            cursor
        }
        scope.launch {
            try {
                handle(fetch(cursor)) { older ->
                    if (epoch != null && older.epoch != epoch) null else applyOlder(older)
                }
            } finally {
                synchronized(lock) { loadingEarlier = false }
            }
        }
    }

    /** The person reached the newest item: the Latest chip has nothing to count. */
    fun seen() {
        synchronized(lock) { current.value = current.value.copy(newCount = 0) }
    }

    /** New items scroll into view only while the person is at the bottom. */
    fun follow(atBottom: Boolean): Boolean = atBottom

    /** CR-34: the pane was switched off "Show on phone": nothing of it stays, and nothing is asked again. */
    fun onHidden() {
        synchronized(lock) {
            hidden = true
            again = false
            epoch = null
            current.value = PaneConversationState(hiddenOnDesktop = true)
        }
    }

    /**
     * Applies a fetch. A page goes through [onPage]; when that returns null (an older page of another session) or the
     * desktop says the conversation changed, the newest page is read once more; a second failure is the Notice.
     */
    private suspend fun handle(result: ConversationFetch, onPage: (ConversationPage) -> Unit?) {
        when (result) {
            is ConversationFetch.Page -> {
                val applied = synchronized(lock) { if (hidden) Unit else onPage(result.page) }
                if (applied == null) recover(NEW_SESSION)
            }
            is ConversationFetch.Changed -> recover(result.reason)
            ConversationFetch.NoConversation -> markUnavailable()
        }
    }

    /** `new-session` replaces with the marker line; `rewritten`, no reason or an unknown one reloads in place. */
    private suspend fun recover(reason: String?) {
        val mode = if (reason == NEW_SESSION) Mode.NEW_SESSION else Mode.REPLACE
        when (val result = fetch(null)) {
            is ConversationFetch.Page -> synchronized(lock) { if (!hidden) applyNewest(result.page, mode) }
            else -> markUnavailable()
        }
    }

    private fun markUnavailable() {
        synchronized(lock) { if (!hidden) current.value = current.value.copy(unavailable = true) }
    }

    private fun applyNewest(page: ConversationPage, mode: Mode) {
        val held = current.value
        val newSession = mode == Mode.NEW_SESSION || (epoch != null && epoch != page.epoch)
        val known = held.items.mapTo(HashSet()) { it.id }
        val incoming = page.items.distinctBy { it.id }
        val overlap = incoming.any { it.id in known }
        current.value = when {
            newSession -> PaneConversationState(items = incoming, olderCursor = page.cursor, newConversation = true, newCount = null)
            mode == Mode.REPLACE -> PaneConversationState(items = incoming, olderCursor = page.cursor, newConversation = held.newConversation, newCount = null)
            overlap -> {
                val byId = incoming.associateBy { it.id }
                val added = incoming.filter { it.id !in known }
                held.copy(
                    items = held.items.map { byId[it.id] ?: it } + added,
                    unavailable = false,
                    newCount = held.newCount?.plus(added.size),
                )
            }
            held.items.isEmpty() -> held.copy(items = incoming, olderCursor = page.cursor, unavailable = false)
            // A gap: what the phone held no longer joins the newest page. Start over from it, with no count.
            else -> PaneConversationState(items = incoming, olderCursor = page.cursor, newCount = null)
        }
        epoch = page.epoch
    }

    /** Older items go before the held ones, in page order, without the ids already held. */
    private fun applyOlder(page: ConversationPage) {
        val held = current.value
        val known = held.items.mapTo(HashSet()) { it.id }
        val older = page.items.distinctBy { it.id }.filter { it.id !in known }
        current.value = held.copy(items = older + held.items, olderCursor = page.cursor, unavailable = false)
    }

    private enum class Mode { MERGE, REPLACE, NEW_SESSION }

    private companion object {
        const val NEW_SESSION = "new-session"
    }
}

/** The Screen · Conversation toggle shows only when the desktop says the pane has a conversation. */
fun showsConversationToggle(pane: RemotePane): Boolean = pane.conversation == true

/** The generated page in the store's model: text messages only, in the desktop's order (oldest to newest). */
fun RemotePaneConversationPage.toConversationPage(): ConversationPage = ConversationPage(
    items = items.mapNotNull { entry -> (entry.item as? RemoteThreadItem.Message)?.let { ConversationItem(it.id, it.role, it.text) } },
    cursor = cursor,
    epoch = epoch,
)

/** Decodes a `pane.conversation` answer (`ack.result`); null when it isn't a page. */
fun conversationPageOf(data: JsonElement?): ConversationPage? = data?.let {
    try {
        RemoteFrames.json.decodeFromJsonElement(RemotePaneConversationPage.serializer(), it).toConversationPage()
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }
}

/**
 * The `paneConversation` stream into a [PaneConversation]: the snapshot is the newest page, an event only says that
 * something changed (the store fetches). A refusal of the stream is the Notice; `pane-hidden` (CR-34) is reported by
 * the hub through [PaneConversation.onHidden].
 */
class PaneConversationFeed(val conversation: PaneConversation) : StreamListener {
    override fun onSnapshot(pages: List<JsonElement>) {
        pages.lastOrNull { conversationPageOf(it) != null }?.let { conversationPageOf(it) }?.let(conversation::onSnapshot)
    }

    override fun onEvent(data: JsonElement) {
        val event = try {
            RemoteFrames.json.decodeFromJsonElement(RemotePaneConversationEvent.serializer(), data)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
        if (event?.changed == true) conversation.onChanged()
    }

    override fun onRefused(code: RemoteErrorCode) {
        conversation.onChanged()
    }
}
