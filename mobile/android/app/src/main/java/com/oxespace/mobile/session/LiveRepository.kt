package com.oxespace.mobile.session

import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.live.AgentsStore
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
 * What the phone follows on the paired desktop. The lists are followed for as long as the app runs; a conversation
 * or a terminal only while its screen is open. Streams survive reconnections and resume from their cursors.
 */
class LiveRepository(val streams: LiveStreams = LiveStreams()) {
    val workspaces = workspacesStore().also { streams.follow(RemoteSubscription.WORKSPACES, listener = it) }
    val threads = ThreadsStore().also { streams.follow(RemoteSubscription.THREADS, listener = it) }
    val agents = AgentsStore()
    private val agentsStream = streams.follow(RemoteSubscription.AGENTS, listener = agents)
    val pendingRequests = pendingRequestsStore().also { streams.follow(RemoteSubscription.PENDING_REQUESTS, listener = it) }
    val jobs = jobsStore().also { streams.follow(RemoteSubscription.JOBS, listener = it) }
    val delegations = delegationsStore().also { streams.follow(RemoteSubscription.DELEGATIONS, listener = it) }

    private val open = mutableMapOf<String, Pair<Followed, Watched<*>>>()

    /** Pull to refresh on Agents: the desktop sends the whole list again. */
    fun refreshAgents() = streams.refresh(agentsStream)

    /** Follows one conversation while its screen is open; the same one twice shares the stream. */
    fun openThread(threadId: String): Watched<ThreadTimeline> = openOne("thread:$threadId") {
        val watched = Watched(ThreadTimeline())
        streams.follow(RemoteSubscription.THREAD, threadId, watched) to watched
    }

    fun openTerminal(paneId: String): Watched<TerminalBuffer> = openOne("terminal:$paneId") {
        val watched = Watched(TerminalBuffer())
        streams.follow(RemoteSubscription.TERMINAL, paneId, watched) to watched
    }

    fun closeThread(threadId: String) = close("thread:$threadId")
    fun closeTerminal(paneId: String) = close("terminal:$paneId")

    @Suppress("UNCHECKED_CAST")
    private fun <S : StreamListener> openOne(key: String, start: () -> Pair<Followed, Watched<S>>): Watched<S> = synchronized(open) {
        open.getOrPut(key, start).second as Watched<S>
    }

    private fun close(key: String) = synchronized(open) { open.remove(key)?.let { streams.unfollow(it.first) } }
}
