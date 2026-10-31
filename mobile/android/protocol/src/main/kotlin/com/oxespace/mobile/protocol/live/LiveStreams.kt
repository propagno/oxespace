package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteCommand
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteSubscription
import java.util.UUID
import kotlinx.serialization.json.JsonObject

/**
 * The streams the app follows and the commands it sends, kept across connections: each new authenticated session
 * is attached and every stream resumes from its cursor; a dropped one is detached and its unanswered commands end as
 * [CommandResult.NoAnswer]. Thread-safe: the UI follows streams and sends commands while the connection's thread
 * delivers frames.
 */
class LiveStreams(
    private val newId: () -> String = { UUID.randomUUID().toString() },
    private val answerTimeoutMs: Long = CommandApi.ANSWER_TIMEOUT_MS,
) {
    private val lock = Any()
    @Volatile private var transport: ((RemoteFrame) -> Unit)? = null
    private val hub = SubscriptionHub(send = { frame -> transport?.invoke(frame) }, newId = newId)
    private val pending = PendingCommands()

    val commands = CommandApi(::run)

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
        pending.dropAll()
    }

    /** A stream the desktop keeps breaking; see [SubscriptionHub.faulted]. */
    val faulted: Boolean get() = synchronized(lock) { hub.faulted }

    /** True when the frame belonged to a stream or answered a command. */
    fun onFrame(frame: RemoteFrame): Boolean = synchronized(lock) { hub.onFrame(frame) || pending.onFrame(frame) }

    private suspend fun run(command: RemoteCommand, args: JsonObject): CommandResult {
        val id = newId()
        val answer = synchronized(lock) {
            val send = transport ?: return CommandResult.Offline
            val waiting = pending.register(id)
            try {
                send(CommandApi.frame(id, command, args))
            } catch (_: IllegalArgumentException) {
                // Over REMOTE_LIMITS: the gateway would close the connection (1009), so it never leaves the phone.
                pending.forget(id)
                return CommandResult.Refused(RemoteErrorCode.FRAME_TOO_LARGE)
            }
            waiting
        }
        val result = CommandApi.await(answer, answerTimeoutMs)
        if (result == CommandResult.NoAnswer) synchronized(lock) { pending.forget(id) }
        return result
    }
}
