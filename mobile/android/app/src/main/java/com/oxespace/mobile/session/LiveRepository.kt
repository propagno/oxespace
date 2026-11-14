package com.oxespace.mobile.session

import com.oxespace.mobile.agents.AgentsState
import com.oxespace.mobile.agents.AgentsStore
import com.oxespace.mobile.agents.apply
import com.oxespace.mobile.protocol.RemoteAgentsEvent
import com.oxespace.mobile.protocol.RemoteAgentsSnapshot
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.live.Followed
import com.oxespace.mobile.protocol.live.LiveStreams
import com.oxespace.mobile.protocol.live.StreamListener
import com.oxespace.mobile.protocol.live.TerminalBuffer
import com.oxespace.mobile.protocol.live.ThreadTimeline
import com.oxespace.mobile.protocol.live.ThreadsStore
import com.oxespace.mobile.protocol.live.delegationsStore
import com.oxespace.mobile.protocol.live.jobsStore
import com.oxespace.mobile.protocol.live.pendingRequestsStore
import com.oxespace.mobile.protocol.live.workspacesStore
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement

/** A store a screen watches: [changes] ticks after every snapshot or event, and [refused] says why it stopped. */
class Watched<Store : StreamListener>(val store: Store) : StreamListener {
    private val tick = MutableStateFlow(0L)
    val changes: StateFlow<Long> = tick.asStateFlow()
    private val refusal = MutableStateFlow<RemoteErrorCode?>(null)
    val refused: StateFlow<RemoteErrorCode?> = refusal.asStateFlow()
    /** False until the first snapshot arrives, so a screen can say it's loading. */
    @Volatile var loaded = false
        private set

    override fun onSnapshot(pages: List<JsonElement>) {
        store.onSnapshot(pages)
        loaded = true
        tick.value++
    }

    override fun onEvent(data: JsonElement) {
        store.onEvent(data)
        tick.value++
    }

    /** Changes the store outside the stream (an older page from history) and tells the screen. */
    fun update(change: (Store) -> Unit) {
        change(store)
        tick.value++
    }

    override fun onRefused(code: RemoteErrorCode) {
        refusal.value = code
    }

    /**
     * CR-F10-8 (CR-34): the desktop ended the stream. The store hears it (a terminal hidden from the phone clears
     * itself) and the screen re-reads it; only an end that isn't `pane-hidden` is a refusal.
     */
    override fun onEnded(code: RemoteErrorCode, reason: String?) {
        store.onEnded(code, reason)
        if (reason != com.oxespace.mobile.protocol.live.PANE_HIDDEN_REASON) refusal.value = code
        tick.value++
    }
}

/**
 * 1.5.0 A43: the C5 `agents` stream into [AgentsStore]. Snapshot pages are joined in order (rows concatenated, the
 * unavailable sources united); a frame that doesn't decode is skipped, so one bad frame never breaks the tab.
 */
class AgentsFeed(val store: AgentsStore = AgentsStore()) : StreamListener {
    val state: StateFlow<AgentsState> get() = store.state
    private val refusal = MutableStateFlow<RemoteErrorCode?>(null)
    val refused: StateFlow<RemoteErrorCode?> = refusal.asStateFlow()

    override fun onSnapshot(pages: List<JsonElement>) {
        val decoded = pages.mapNotNull { page -> decode { RemoteFrames.json.decodeFromJsonElement(RemoteAgentsSnapshot.serializer(), page) } }
        if (decoded.isEmpty() && pages.isNotEmpty()) return
        store.apply(RemoteAgentsSnapshot(rows = decoded.flatMap { it.rows }, unavailable = decoded.flatMap { it.unavailable }.distinct()))
    }

    override fun onEvent(data: JsonElement) {
        decode { RemoteFrames.json.decodeFromJsonElement(RemoteAgentsEvent.serializer(), data) }?.let { store.apply(it) }
    }

    override fun onRefused(code: RemoteErrorCode) {
        refusal.value = code
    }

    private inline fun <T> decode(block: () -> T): T? =
        try {
            block()
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
}

/**
 * What the phone follows on the paired desktop. The lists are followed for as long as the app runs; a conversation
 * or a terminal only while its screen is open. Streams survive reconnections and resume from their cursors.
 */
class LiveRepository(val streams: LiveStreams = LiveStreams()) {
    val workspaces = workspacesStore().also { streams.follow(RemoteSubscription.WORKSPACES, listener = it) }
    val threads = ThreadsStore().also { streams.follow(RemoteSubscription.THREADS, listener = it) }
    val pendingRequests = pendingRequestsStore().also { streams.follow(RemoteSubscription.PENDING_REQUESTS, listener = it) }
    val jobs = jobsStore().also { streams.follow(RemoteSubscription.JOBS, listener = it) }
    val delegations = delegationsStore().also { streams.follow(RemoteSubscription.DELEGATIONS, listener = it) }
    /** 1.5.0 A43: the Agents tab's rows, only from the C5 `agents` topic. */
    val agents = AgentsFeed().also { streams.follow(RemoteSubscription.AGENTS, listener = it) }

    private val open = mutableMapOf<String, Pair<Followed, Watched<*>>>()

    /** Follows one conversation while its screen is open; the same one twice shares the stream. */
    fun openThread(threadId: String): Watched<ThreadTimeline> = openOne("thread:$threadId") {
        val watched = Watched(ThreadTimeline())
        streams.follow(RemoteSubscription.THREAD, threadId, watched) to watched
    }

    fun openTerminal(paneId: String): Watched<TerminalBuffer> = openOne("terminal:$paneId") {
        val watched = Watched(TerminalBuffer())
        streams.follow(RemoteSubscription.TERMINAL, paneId, watched) to watched
    }

    private val conversationScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Default)
    private val conversations = mutableMapOf<String, Pair<Followed, com.oxespace.mobile.protocol.live.PaneConversation>>()

    /** 1.5.0 · The size of the terminal the phone has open, held for this screen; see [com.oxespace.mobile.protocol.live.TerminalSizeHold]. */
    val terminalSize = com.oxespace.mobile.protocol.live.TerminalSizeHold(
        scope = conversationScope,
        supported = { com.oxespace.mobile.protocol.live.TerminalSizeHold.FEATURE in streams.features },
        resize = { streams.commands.terminalResize(it) },
        release = { streams.commands.terminalRelease(it) },
    )

    /**
     * 1.5.0 A46: follows a pane agent's conversation while its view is open; the same pane twice shares the stream.
     * The snapshot is the newest page; a `changed` event makes the store fetch with `pane.conversation`.
     */
    fun openPaneConversation(paneId: String): com.oxespace.mobile.protocol.live.PaneConversation = synchronized(conversations) {
        conversations.getOrPut(paneId) {
            val conversation = com.oxespace.mobile.protocol.live.PaneConversation(conversationScope) { cursor -> paneConversationFetch(paneId, cursor) }
            streams.follow(RemoteSubscription.PANE_CONVERSATION, paneId, com.oxespace.mobile.protocol.live.PaneConversationFeed(conversation)) to conversation
        }.second
    }

    fun closePaneConversation(paneId: String) = synchronized(conversations) { conversations.remove(paneId)?.let { streams.unfollow(it.first) } }

    /** CR-F10-7: a fetch is the `pane.conversation` command, newest page without a cursor, older with one. */
    private suspend fun paneConversationFetch(paneId: String, cursor: String?): com.oxespace.mobile.protocol.live.ConversationFetch =
        com.oxespace.mobile.protocol.live.conversationFetchOf(
            streams.commands.paneConversation(com.oxespace.mobile.protocol.RemotePaneConversationArgs(paneId, cursor)),
        )

    /**
     * CR-F10-7 (A43): tells the desktop the person looked at a finished agent (`agent.markSeen { kind, id }`). Fire and
     * forget: a refusal or a drop changes nothing on the phone, the next `agents` event says what the desktop holds.
     */
    fun markAgentSeen(key: com.oxespace.mobile.agents.AgentKey) {
        val kind = com.oxespace.mobile.protocol.RemoteAgentKind.entries.firstOrNull { it.wire == key.kind } ?: return
        conversationScope.launch { streams.commands.markSeen(com.oxespace.mobile.protocol.RemoteAgentMarkSeenArgs(kind, key.id)) }
    }

    fun closeThread(threadId: String) = close("thread:$threadId")
    fun closeTerminal(paneId: String) = close("terminal:$paneId")

    @Suppress("UNCHECKED_CAST")
    private fun <S : StreamListener> openOne(key: String, start: () -> Pair<Followed, Watched<S>>): Watched<S> = synchronized(open) {
        open.getOrPut(key, start).second as Watched<S>
    }

    private fun close(key: String) = synchronized(open) { open.remove(key)?.let { streams.unfollow(it.first) } }
}
