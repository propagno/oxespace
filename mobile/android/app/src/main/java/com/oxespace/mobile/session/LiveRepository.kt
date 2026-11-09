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

    /** 1.5.0 F10 skeleton (A46): follows a pane agent's conversation while its view is open. MOB-A46 replaces the TODO. */
    @Suppress("UNUSED_PARAMETER")
    fun openPaneConversation(paneId: String): com.oxespace.mobile.protocol.live.PaneConversation = TODO("F10 A46")

    fun closeThread(threadId: String) = close("thread:$threadId")
    fun closeTerminal(paneId: String) = close("terminal:$paneId")

    @Suppress("UNCHECKED_CAST")
    private fun <S : StreamListener> openOne(key: String, start: () -> Pair<Followed, Watched<S>>): Watched<S> = synchronized(open) {
        open.getOrPut(key, start).second as Watched<S>
    }

    private fun close(key: String) = synchronized(open) { open.remove(key)?.let { streams.unfollow(it.first) } }
}
