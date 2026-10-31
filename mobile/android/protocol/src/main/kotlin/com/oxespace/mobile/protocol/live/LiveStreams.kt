package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteSubscription
import java.util.UUID

/**
 * The streams the app follows, kept across connections: each new authenticated session is attached and every
 * stream resumes from its cursor; a dropped one is detached. Thread-safe: the UI follows streams while the
 * connection's thread delivers frames.
 */
class LiveStreams(newId: () -> String = { UUID.randomUUID().toString() }) {
    private val lock = Any()
    @Volatile private var transport: ((RemoteFrame) -> Unit)? = null
    private val hub = SubscriptionHub(send = { frame -> transport?.invoke(frame) }, newId = newId)

    fun follow(topic: RemoteSubscription, target: String? = null, listener: StreamListener): Followed =
        synchronized(lock) { hub.follow(topic, target, listener) }

    fun unfollow(stream: Followed) = synchronized(lock) { hub.unfollow(stream) }

    /** A session is ready: frames go out through [send] and every stream (re)subscribes. */
    fun attach(send: (RemoteFrame) -> Unit) = synchronized(lock) {
        transport = send
        hub.onConnected()
    }

    fun detach() = synchronized(lock) {
        transport = null
        hub.onDisconnected()
    }

    /** A stream the desktop keeps breaking; see [SubscriptionHub.faulted]. */
    val faulted: Boolean get() = synchronized(lock) { hub.faulted }

    /** True when the frame belonged to a stream. */
    fun onFrame(frame: RemoteFrame): Boolean = synchronized(lock) { hub.onFrame(frame) }
}
