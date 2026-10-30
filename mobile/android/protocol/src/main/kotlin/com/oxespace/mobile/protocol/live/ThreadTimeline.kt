package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteThreadHeader
import com.oxespace.mobile.protocol.RemoteThreadItem
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/** One timeline item and where it first appeared. */
data class TimelineEntry(val seq: Long, val item: RemoteThreadItem)

/**
 * A conversation as the phone shows it, built from the `thread` stream: a snapshot replaces it, an event adds items
 * or replaces one with the same id in place (a message that grew, a tool that finished). Items keep the position of
 * their first appearance. An item of a type this app doesn't know yet is skipped, not the whole frame. Frames arrive
 * on the connection's thread while the screen reads, so every access holds the timeline's lock.
 */
class ThreadTimeline : StreamListener {
    var header: RemoteThreadHeader? = null
        private set
    /** Older items exist before the first one held (`thread.history`). */
    var hasMore: Boolean = false
        private set
    /** Items skipped because a newer desktop sent a type this app doesn't know. */
    var skipped: Int = 0
        private set

    private val byId = LinkedHashMap<String, TimelineEntry>()

    val items: List<TimelineEntry> get() = synchronized(this) { byId.values.sortedBy { it.seq } }

    override fun onSnapshot(pages: List<JsonElement>) = synchronized(this) {
        byId.clear()
        skipped = 0
        for (page in pages) {
            val body = page as? JsonObject ?: continue
            readHeader(body)?.let { header = it }
            (body["hasMore"] as? JsonPrimitive)?.booleanOrNull?.let { hasMore = it }
            readItems(body).forEach(::put)
        }
    }

    override fun onEvent(data: JsonElement) {
        val body = data as? JsonObject ?: return
        synchronized(this) {
            readHeader(body)?.let { header = it }
            readItems(body).forEach(::put)
        }
    }

    /** An older page from `thread.history`, placed before what is held. */
    fun prepend(page: JsonElement) {
        val body = page as? JsonObject ?: return
        synchronized(this) {
            (body["hasMore"] as? JsonPrimitive)?.booleanOrNull?.let { hasMore = it }
            readItems(body).forEach { entry -> if (entry.item.id !in byId) put(entry) }
        }
    }

    private fun put(entry: TimelineEntry) {
        val previous = byId[entry.item.id]
        byId[entry.item.id] = if (previous == null) entry else entry.copy(seq = previous.seq)
    }

    private fun readHeader(body: JsonObject): RemoteThreadHeader? = body["thread"]?.let {
        try {
            RemoteFrames.json.decodeFromJsonElement(RemoteThreadHeader.serializer(), it)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun readItems(body: JsonObject): List<TimelineEntry> {
        val list = body["items"] as? JsonArray ?: return emptyList()
        return list.mapNotNull { element ->
            val wrapper = element as? JsonObject
            val seq = (wrapper?.get("seq") as? JsonPrimitive)?.longOrNull
            val item = wrapper?.get("item")?.let(::readItem)
            if (seq == null || item == null) {
                skipped++
                null
            } else {
                TimelineEntry(seq, item)
            }
        }
    }

    private fun readItem(element: JsonElement): RemoteThreadItem? =
        try {
            RemoteFrames.json.decodeFromJsonElement(RemoteThreadItem.serializer(), element)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
}

/** Every item carries an id; the sealed classes each declare it. */
val RemoteThreadItem.id: String
    get() = when (this) {
        is RemoteThreadItem.Message -> id
        is RemoteThreadItem.Reasoning -> id
        is RemoteThreadItem.Tool -> id
        is RemoteThreadItem.Plan -> id
        is RemoteThreadItem.Request -> id
        is RemoteThreadItem.Subagent -> id
        is RemoteThreadItem.Completed -> id
    }
