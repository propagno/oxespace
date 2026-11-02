package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteEventFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteLimits
import com.oxespace.mobile.protocol.RemoteSnapshotFrame
import com.oxespace.mobile.protocol.RemoteSubscribeFrame
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.RemoteUnsubscribeFrame
import kotlinx.serialization.json.JsonElement

/** What a followed stream hands over: a whole state, a change, or why the desktop refused it. */
interface StreamListener {
    /** The whole state, in the pages the gateway split it into (one page when it fits a frame). Replaces everything. */
    fun onSnapshot(pages: List<JsonElement>)
    fun onEvent(data: JsonElement)
    /** `not-found`, `forbidden`, `too-many-subscriptions`…: the stream is no longer followed. */
    fun onRefused(code: RemoteErrorCode) {}
}

/** A stream the app asked for; stays followed across reconnections until [SubscriptionHub.unfollow]. */
class Followed internal constructor(val topic: RemoteSubscription, val target: String?, internal val listener: StreamListener) {
    /** The gateway's name for the stream on this connection; null until acknowledged. */
    internal var name: String? = null
    internal var pendingId: String? = null
    /** Where to resume from: the gateway's opaque cursor of the last snapshot or event applied. */
    internal var cursor: String? = null
    internal var lastSeq: Long? = null
    /** Times it asked again since something was last applied. */
    internal var fruitlessResumes = 0
    internal val pages = mutableListOf<JsonElement>()
}

/**
 * Follows C5 subscriptions over a session: subscribes, gathers snapshot pages, checks that events arrive without
 * gaps, and after a reconnection or a gap subscribes again from the last cursor, so nothing is lost or applied twice.
 * Not thread-safe: the connection calls it under its lock.
 */
class SubscriptionHub(private val send: (RemoteFrame) -> Unit, private val newId: () -> String) {
    private val followed = mutableListOf<Followed>()
    private var connected = false

    /**
     * The desktop keeps breaking a stream (gaps or interruptions [MAX_FRUITLESS_RESUMES] times in a row with nothing
     * applied): asking again would only loop, so the session should end as a protocol fault. Cleared on reconnecting.
     */
    var faulted = false
        private set

    fun follow(topic: RemoteSubscription, target: String? = null, listener: StreamListener): Followed {
        require(followed.size < RemoteLimits.MAX_SUBSCRIPTIONS) { "at most ${RemoteLimits.MAX_SUBSCRIPTIONS} streams" }
        val stream = Followed(topic, target, listener)
        followed += stream
        if (connected) subscribe(stream)
        return stream
    }

    fun unfollow(stream: Followed) {
        if (!followed.remove(stream)) return
        val name = stream.name
        if (connected && name != null) send(RemoteUnsubscribeFrame(id = newId(), subscription = name))
    }

    /** The session is authenticated: (re)subscribe every followed stream from where it stopped. */
    fun onConnected() {
        connected = true
        faulted = false
        followed.forEach { it.fruitlessResumes = 0 }
        followed.forEach(::subscribe)
    }

    /** The connection is gone; names die with it, cursors stay. */
    fun onDisconnected() {
        connected = false
        followed.forEach { it.forget() }
    }

    /** Handles the frames that belong to subscriptions; returns false for anything else. */
    fun onFrame(frame: RemoteFrame): Boolean = when (frame) {
        is RemoteAckFrame -> followed.firstOrNull { it.pendingId == frame.id }?.let { stream ->
            stream.pendingId = null
            stream.name = frame.subscription
            true
        } ?: false
        is RemoteErrorFrame -> followed.firstOrNull { frame.id != null && it.pendingId == frame.id }?.let { stream ->
            followed.remove(stream)
            stream.listener.onRefused(frame.code)
            true
        } ?: false
        is RemoteSnapshotFrame -> streamNamed(frame.subscription)?.let { onSnapshot(it, frame); true } ?: false
        is RemoteEventFrame -> streamNamed(frame.subscription)?.let { onEvent(it, frame); true } ?: false
        else -> false
    }

    private fun streamNamed(name: String) = followed.firstOrNull { it.name == name }

    private fun onSnapshot(stream: Followed, frame: RemoteSnapshotFrame) {
        if (!inOrder(stream, frame.seq)) return
        stream.pages += frame.data
        val page = frame.page
        if (page != null && !page.last) return
        val pages = stream.pages.toList()
        stream.pages.clear()
        frame.cursor?.let { stream.cursor = it }
        stream.fruitlessResumes = 0
        stream.listener.onSnapshot(pages)
    }

    private fun onEvent(stream: Followed, frame: RemoteEventFrame) {
        // An event in the middle of a paged snapshot breaks it as surely as a gap.
        if (stream.pages.isNotEmpty()) return resubscribe(stream)
        if (!inOrder(stream, frame.seq)) return
        // The point already applied, sent again: the change is in what the phone holds.
        if (frame.cursor != null && frame.cursor == stream.cursor) return
        frame.cursor?.let { stream.cursor = it }
        stream.fruitlessResumes = 0
        stream.listener.onEvent(frame.data)
    }

    /**
     * Frames of one stream come numbered one after another; a gap means something was lost. A number already seen is
     * a repeat, dropped without asking again.
     */
    private fun inOrder(stream: Followed, seq: Long): Boolean {
        val last = stream.lastSeq
        if (last != null && seq <= last) return false
        if (last != null && seq != last + 1) {
            resubscribe(stream)
            return false
        }
        stream.lastSeq = seq
        return true
    }

    /** Drops this connection's stream and asks again from the last cursor applied. */
    private fun resubscribe(stream: Followed) {
        if (++stream.fruitlessResumes > MAX_FRUITLESS_RESUMES) {
            faulted = true
            return
        }
        stream.name?.let { send(RemoteUnsubscribeFrame(id = newId(), subscription = it)) }
        stream.forget()
        if (connected) subscribe(stream)
    }

    private fun subscribe(stream: Followed) {
        stream.forget()
        val id = newId()
        stream.pendingId = id
        send(RemoteSubscribeFrame(id = id, topic = stream.topic, target = stream.target, cursor = stream.cursor))
    }

    private fun Followed.forget() {
        name = null
        pendingId = null
        lastSeq = null
        pages.clear()
    }

    private companion object {
        const val MAX_FRUITLESS_RESUMES = 3
    }
}
