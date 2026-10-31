package com.oxespace.mobile.protocol

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** Who sent a frame: the phone (client) or the desktop gateway. */
enum class FrameSource { CLIENT, DESKTOP }

sealed interface FrameRead {
    data class Ok(val frame: RemoteFrame) : FrameRead
    data class Refused(val code: RemoteErrorCode) : FrameRead
}

/**
 * The Kotlin side of `readRemoteFrame` in shared/remote/protocol.ts: size, JSON object, known type, a type the sender
 * may send and a known command, in that order and with the same error codes. Then the fields are decoded into the
 * generated classes, and a frame whose fields don't fit is `malformed`.
 */
object RemoteFrames {
    /** Fields are only ever added to the protocol, so unknown ones are ignored. */
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    fun read(text: String, from: FrameSource): FrameRead {
        if (text.toByteArray(Charsets.UTF_8).size > RemoteLimits.MAX_FRAME_BYTES) return FrameRead.Refused(RemoteErrorCode.FRAME_TOO_LARGE)
        val value = try {
            json.parseToJsonElement(text)
        } catch (_: SerializationException) {
            return FrameRead.Refused(RemoteErrorCode.MALFORMED)
        }
        if (value !is JsonObject) return FrameRead.Refused(RemoteErrorCode.MALFORMED)
        val type = value.stringField("type")?.let(RemoteFrameType::fromWire) ?: return FrameRead.Refused(RemoteErrorCode.MALFORMED)
        if (from == FrameSource.CLIENT && type !in REMOTE_CLIENT_FRAMES) return FrameRead.Refused(RemoteErrorCode.MALFORMED)
        if (type == RemoteFrameType.COMMAND && value.stringField("command")?.let(RemoteCommand::fromWire) == null) {
            return FrameRead.Refused(RemoteErrorCode.UNKNOWN_COMMAND)
        }
        return try {
            FrameRead.Ok(json.decodeFromJsonElement(RemoteFrame.serializer(), withKnownErrorCode(type, value)))
        } catch (_: SerializationException) {
            FrameRead.Refused(RemoteErrorCode.MALFORMED)
        } catch (_: IllegalArgumentException) {
            FrameRead.Refused(RemoteErrorCode.MALFORMED)
        }
    }

    /** JSON for a frame the phone sends. Desktop-only frames and oversized ones are a bug on this side, so they throw. */
    fun write(frame: RemoteFrame): String {
        val text = json.encodeToString(RemoteFrame.serializer(), frame)
        val type = RemoteFrameType.fromWire((json.parseToJsonElement(text) as JsonObject).stringField("type").orEmpty())
        require(type in REMOTE_CLIENT_FRAMES) { "the phone never sends a $type frame" }
        require(text.toByteArray(Charsets.UTF_8).size <= RemoteLimits.MAX_FRAME_BYTES) { "frame over ${RemoteLimits.MAX_FRAME_BYTES} bytes" }
        return text
    }

    /**
     * Error codes are only added, so a newer desktop may send one this app doesn't know yet. It reads as `internal`
     * instead of losing the whole frame and the request it answers.
     */
    private fun withKnownErrorCode(type: RemoteFrameType, value: JsonObject): JsonObject {
        if (type != RemoteFrameType.ERROR) return value
        val code = value.stringField("code") ?: return value
        if (RemoteErrorCode.fromWire(code) != null) return value
        return JsonObject(value + ("code" to JsonPrimitive(RemoteErrorCode.INTERNAL.wire)))
    }

    private fun JsonObject.stringField(name: String): String? =
        (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.jsonPrimitive?.contentOrNull
}
