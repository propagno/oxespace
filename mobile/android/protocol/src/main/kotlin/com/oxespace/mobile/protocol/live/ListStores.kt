package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteDelegation
import com.oxespace.mobile.protocol.RemoteDelegationsData
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteJob
import com.oxespace.mobile.protocol.RemoteJobsData
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemotePendingRequestsData
import com.oxespace.mobile.protocol.RemoteThreadSummary
import com.oxespace.mobile.protocol.RemoteThreadsEvent
import com.oxespace.mobile.protocol.RemoteThreadsSnapshot
import com.oxespace.mobile.protocol.RemoteWorkspace
import com.oxespace.mobile.protocol.RemoteWorkspacesData
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement

/** Decodes a payload, or null when it doesn't fit: one bad frame never breaks the screen that shows the stream. */
internal fun <T> decodeOrNull(serializer: KSerializer<T>, element: JsonElement): T? =
    try {
        RemoteFrames.json.decodeFromJsonElement(serializer, element)
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

/**
 * A stream whose snapshot and every event carry the whole list (workspaces, pending requests, jobs, delegations):
 * the latest one wins. Pages of a snapshot are joined in order.
 */
class WholeListStore<Data, Item>(
    private val serializer: KSerializer<Data>,
    private val itemsOf: (Data) -> List<Item>,
) : StreamListener {
    private val mutable = MutableStateFlow<List<Item>>(emptyList())
    val items: StateFlow<List<Item>> = mutable.asStateFlow()

    override fun onSnapshot(pages: List<JsonElement>) {
        mutable.value = pages.mapNotNull { decodeOrNull(serializer, it) }.flatMap(itemsOf)
    }

    override fun onEvent(data: JsonElement) {
        decodeOrNull(serializer, data)?.let { mutable.value = itemsOf(it) }
    }
}

fun workspacesStore() = WholeListStore(RemoteWorkspacesData.serializer()) { it.workspaces }
fun pendingRequestsStore() = WholeListStore(RemotePendingRequestsData.serializer()) { it.requests }
fun jobsStore() = WholeListStore(RemoteJobsData.serializer()) { it.jobs }
fun delegationsStore() = WholeListStore(RemoteDelegationsData.serializer()) { it.delegations }

typealias WorkspacesStore = WholeListStore<RemoteWorkspacesData, RemoteWorkspace>
typealias PendingRequestsStore = WholeListStore<RemotePendingRequestsData, RemotePendingRequest>
typealias JobsStore = WholeListStore<RemoteJobsData, RemoteJob>
typealias DelegationsStore = WholeListStore<RemoteDelegationsData, RemoteDelegation>

/** The conversations list: a snapshot of all, then changes (`upsert`, `removed`), newest first. */
class ThreadsStore : StreamListener {
    private val mutable = MutableStateFlow<List<RemoteThreadSummary>>(emptyList())
    val threads: StateFlow<List<RemoteThreadSummary>> = mutable.asStateFlow()

    override fun onSnapshot(pages: List<JsonElement>) {
        mutable.value = sorted(pages.mapNotNull { decodeOrNull(RemoteThreadsSnapshot.serializer(), it) }.flatMap { it.threads })
    }

    override fun onEvent(data: JsonElement) {
        val change = decodeOrNull(RemoteThreadsEvent.serializer(), data) ?: return
        val byId = mutable.value.associateBy { it.id }.toMutableMap()
        change.removed?.forEach { byId.remove(it) }
        change.upsert?.forEach { byId[it.id] = it }
        mutable.value = sorted(byId.values)
    }

    private fun sorted(threads: Collection<RemoteThreadSummary>) = threads.distinctBy { it.id }.sortedByDescending { it.updatedAt }
}
