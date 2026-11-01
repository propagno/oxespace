package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteAgentMarkSeenArgs
import com.oxespace.mobile.protocol.RemoteCommand
import com.oxespace.mobile.protocol.RemoteCommandFrame
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteRespondRequestArgs
import com.oxespace.mobile.protocol.RemoteTerminalWriteArgs
import com.oxespace.mobile.protocol.RemoteThreadHistoryArgs
import com.oxespace.mobile.protocol.RemoteThreadInterruptArgs
import com.oxespace.mobile.protocol.RemoteThreadSendArgs
import com.oxespace.mobile.protocol.RemoteThreadSteerArgs
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** How a command ended, as the screen needs to tell the person. */
sealed interface CommandResult {
    data class Done(val result: JsonElement?) : CommandResult
    /** The desktop said no: forbidden, not-pending, stale-generation, pane-not-shared, rate-limited… */
    data class Refused(val code: RemoteErrorCode, val retryAfterMs: Long? = null) : CommandResult
    /** Not connected: nothing was sent. */
    data object Offline : CommandResult
    /** Sent, but no answer came in time; a send or steer can be repeated with the same clientId safely. */
    data object NoAnswer : CommandResult
}

/** Commands of one connection, answered by `ack` or `error` with the same id. */
internal class PendingCommands {
    private val waiting = mutableMapOf<String, CompletableDeferred<CommandResult>>()

    fun register(id: String): CompletableDeferred<CommandResult> = CompletableDeferred<CommandResult>().also { waiting[id] = it }

    fun forget(id: String) = waiting.remove(id)

    /** True when the frame answered a command. */
    fun onFrame(frame: RemoteFrame): Boolean = when (frame) {
        is RemoteAckFrame -> waiting.remove(frame.id)?.complete(CommandResult.Done(frame.result)) != null
        is RemoteErrorFrame -> frame.id?.let { waiting.remove(it) }?.complete(CommandResult.Refused(frame.code, frame.retryAfterMs)) != null
        else -> false
    }

    /** The connection ended: whatever was waiting will never be answered on it. */
    fun dropAll() {
        waiting.values.forEach { it.complete(CommandResult.NoAnswer) }
        waiting.clear()
    }
}

/** Typed commands of C5, as JSON args. Approvals go through the app's biometric gate before reaching [respondRequest]. */
class CommandApi internal constructor(private val run: suspend (RemoteCommand, JsonObject) -> CommandResult) {
    suspend fun send(args: RemoteThreadSendArgs) = run(RemoteCommand.THREAD_SEND, encode(RemoteThreadSendArgs.serializer(), args))
    suspend fun steer(args: RemoteThreadSteerArgs) = run(RemoteCommand.THREAD_STEER, encode(RemoteThreadSteerArgs.serializer(), args))
    suspend fun interrupt(args: RemoteThreadInterruptArgs) = run(RemoteCommand.THREAD_INTERRUPT, encode(RemoteThreadInterruptArgs.serializer(), args))
    suspend fun respondRequest(args: RemoteRespondRequestArgs) = run(RemoteCommand.THREAD_RESPOND_REQUEST, encode(RemoteRespondRequestArgs.serializer(), args))
    suspend fun terminalWrite(args: RemoteTerminalWriteArgs) = run(RemoteCommand.TERMINAL_WRITE, encode(RemoteTerminalWriteArgs.serializer(), args))
    suspend fun history(args: RemoteThreadHistoryArgs) = run(RemoteCommand.THREAD_HISTORY, encode(RemoteThreadHistoryArgs.serializer(), args))
    /** Clears an agent's "finished" only (S7.1); it never answers, stops or starts anything. */
    suspend fun markSeen(args: RemoteAgentMarkSeenArgs) = run(RemoteCommand.AGENT_MARK_SEEN, encode(RemoteAgentMarkSeenArgs.serializer(), args))

    private fun <T> encode(serializer: KSerializer<T>, value: T) = RemoteFrames.json.encodeToJsonElement(serializer, value) as JsonObject

    internal companion object {
        const val ANSWER_TIMEOUT_MS = 15_000L

        suspend fun await(answer: CompletableDeferred<CommandResult>, timeoutMs: Long): CommandResult =
            withTimeoutOrNull(timeoutMs) { answer.await() } ?: CommandResult.NoAnswer

        fun frame(id: String, command: RemoteCommand, args: JsonObject) = RemoteCommandFrame(id = id, command = command, args = args)
    }
}
