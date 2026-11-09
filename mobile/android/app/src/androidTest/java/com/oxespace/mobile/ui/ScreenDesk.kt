package com.oxespace.mobile.ui

import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteSnapshotFrame
import com.oxespace.mobile.protocol.RemoteSubscribeFrame
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.live.LiveStreams
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.JsonElement

/**
 * Frozen test helper for the 1.5.0 F10 UI tests (CR-A43, CR-CR34). Written by the planner; the executor must not edit it.
 *
 * The desktop side of a screen test, where the WSS session sits ([LiveStreams.attach]): it answers each subscribe with an
 * ack and the snapshot [serve] gave for its topic, and [end] closes a stream the way the desktop does (an error frame
 * naming the subscription). Replies go out on its own thread, as frames from a socket would.
 */
class ScreenDesk : AutoCloseable {
    val streams = LiveStreams()
    val fromPhone = CopyOnWriteArrayList<RemoteFrame>()
    private val desk = Executors.newSingleThreadExecutor()
    private val snapshots = ConcurrentHashMap<RemoteSubscription, JsonElement>()
    private val names = ConcurrentHashMap<String, String>()

    fun json(text: String): JsonElement = RemoteFrames.json.parseToJsonElement(text)

    fun serve(topic: RemoteSubscription, snapshot: JsonElement) { snapshots[topic] = snapshot }

    fun connect() = streams.attach { frame ->
        fromPhone += frame
        desk.execute { reply(frame) }
    }

    /** Ends the open stream of [topic] / [target] with [code] and [reason], as the desktop does for a hidden pane. */
    fun end(topic: RemoteSubscription, target: String?, code: RemoteErrorCode, reason: String?) {
        desk.submit {
            val name = names["${topic.wire}|${target.orEmpty()}"] ?: error("no subscription to ${topic.wire}")
            streams.onFrame(RemoteErrorFrame(subscription = name, code = code, reason = reason))
        }.get(5, TimeUnit.SECONDS)
    }

    fun settle() { desk.submit {}.get(5, TimeUnit.SECONDS) }

    override fun close() {
        streams.detach()
        desk.shutdownNow()
    }

    private fun reply(frame: RemoteFrame) {
        if (frame !is RemoteSubscribeFrame) return
        val name = "s-${frame.topic.wire}-${frame.id}"
        names["${frame.topic.wire}|${frame.target.orEmpty()}"] = name
        streams.onFrame(RemoteAckFrame(id = frame.id, subscription = name))
        val data = snapshots[frame.topic] ?: return
        streams.onFrame(RemoteSnapshotFrame(subscription = name, seq = 1, schemaVersion = 1, data = data))
    }
}
