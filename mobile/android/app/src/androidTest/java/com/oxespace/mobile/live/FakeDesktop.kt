package com.oxespace.mobile.live

import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteCommand
import com.oxespace.mobile.protocol.RemoteCommandFrame
import com.oxespace.mobile.protocol.RemoteEventFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteSnapshotFrame
import com.oxespace.mobile.protocol.RemoteSubscribeFrame
import com.oxespace.mobile.protocol.RemoteSubscription
import com.oxespace.mobile.protocol.live.LiveStreams
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Frozen test helper for the 1.5.0 F10 on-device tests. Written by the planner; the executor must not edit it.
 *
 * The in-test fake desktop: it sits where the WSS session sits ([LiveStreams.attach]), as NoFrameWithoutBiometricsTest
 * does, so a test runs the app's real streams, stores and commands on an Android runtime without a network. It answers
 * a subscribe with an ack and the snapshot [serve] gives for that topic, a command with an ack and the result [answer]
 * gives, and sends events on [event]. Replies go out on the desktop's own thread, as frames arrive from a socket.
 */
class FakeDesktop : AutoCloseable {
    val streams = LiveStreams()
    /** Every frame the phone sent, in order. */
    val fromPhone = CopyOnWriteArrayList<RemoteFrame>()

    private val desk = Executors.newSingleThreadExecutor()
    private val snapshots = ConcurrentHashMap<RemoteSubscription, (String?) -> JsonElement>()
    private val answers = ConcurrentHashMap<RemoteCommand, (JsonObject) -> JsonElement?>()
    private val names = ConcurrentHashMap<String, String>()
    private val seqs = ConcurrentHashMap<String, AtomicLong>()

    /** The snapshot a subscribe to [topic] gets; `target` is the pane or thread it names, if any. */
    fun serve(topic: RemoteSubscription, snapshot: (target: String?) -> JsonElement) { snapshots[topic] = snapshot }

    /** The `ack.result` a [command] gets; without one it gets an ack with no result. */
    fun answer(command: RemoteCommand, result: (args: JsonObject) -> JsonElement?) { answers[command] = result }

    /** The session is ready: the app's streams subscribe through this desktop. */
    fun connect() = streams.attach { frame ->
        fromPhone += frame
        desk.execute { reply(frame) }
    }

    /** An event on the subscription to [topic] (and [target]); waits until the phone has taken it. */
    fun event(topic: RemoteSubscription, target: String? = null, data: JsonElement) {
        desk.submit {
            val name = names[key(topic, target)] ?: error("the phone never subscribed to ${topic.wire} ${target.orEmpty()}")
            streams.onFrame(RemoteEventFrame(subscription = name, seq = next(name), schemaVersion = 1, data = data))
        }.get(5, TimeUnit.SECONDS)
    }

    /** Waits until everything the desktop was asked so far has been answered. */
    fun settle() { desk.submit {}.get(5, TimeUnit.SECONDS) }

    fun commands(command: RemoteCommand): List<RemoteCommandFrame> = fromPhone.filterIsInstance<RemoteCommandFrame>().filter { it.command == command }
    fun subscribes(topic: RemoteSubscription): List<RemoteSubscribeFrame> = fromPhone.filterIsInstance<RemoteSubscribeFrame>().filter { it.topic == topic }

    override fun close() {
        streams.detach()
        desk.shutdownNow()
    }

    private fun reply(frame: RemoteFrame) {
        when (frame) {
            is RemoteSubscribeFrame -> {
                val name = "s-${frame.topic.wire}-${frame.target.orEmpty()}-${frame.id}"
                names[key(frame.topic, frame.target)] = name
                streams.onFrame(RemoteAckFrame(id = frame.id, subscription = name))
                val data = snapshots[frame.topic]?.invoke(frame.target) ?: return
                streams.onFrame(RemoteSnapshotFrame(subscription = name, seq = next(name), schemaVersion = 1, data = data))
            }
            is RemoteCommandFrame -> streams.onFrame(RemoteAckFrame(id = frame.id, result = answers[frame.command]?.invoke(frame.args)))
            else -> Unit
        }
    }

    private fun key(topic: RemoteSubscription, target: String?) = "${topic.wire}|${target.orEmpty()}"
    private fun next(name: String) = seqs.getOrPut(name) { AtomicLong(0) }.incrementAndGet()
}
