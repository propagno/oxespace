package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteAgentKind
import com.oxespace.mobile.protocol.RemoteAgentRow
import com.oxespace.mobile.protocol.RemoteAgentsEvent
import com.oxespace.mobile.protocol.RemoteAgentsSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonElement

/** What the phone holds of the `agents` subscription (S7.1). */
data class AgentsState(
    val rows: List<RemoteAgentRow> = emptyList(),
    /** The sources that failed this time: the screen shows the partial notice. */
    val unavailable: List<String> = emptyList(),
    /** The desktop's needs-you timer, absent when it is off. Only a snapshot sets it. */
    val nudgeAfterMs: Long? = null,
    /** False until the first snapshot arrives. */
    val loaded: Boolean = false,
)

/**
 * The `agents` stream: a snapshot (in pages, joined by the hub), then upserts and removals. The phone never maps a state
 * itself; it only applies the C5 unknown-value rules: a row of a kind it doesn't know is skipped, and an unknown state is
 * read as `unknown` where it is shown (`RemoteAgentState.read`). Only the snapshot carries `nudgeAfterMs`; a change of
 * that setting arrives as a fresh snapshot.
 */
class AgentsStore : StreamListener {
    private val mutable = MutableStateFlow(AgentsState())
    val state: StateFlow<AgentsState> = mutable.asStateFlow()

    override fun onSnapshot(pages: List<JsonElement>) {
        val decoded = pages.mapNotNull { decodeOrNull(RemoteAgentsSnapshot.serializer(), it) }
        // `unavailable` and `nudgeAfterMs` ride on the page marked last only.
        val last = decoded.lastOrNull()
        mutable.value = AgentsState(
            rows = decoded.flatMap { it.agents }.filter(::known).associateBy { it.id }.values.toList(),
            unavailable = last?.unavailable.orEmpty(),
            nudgeAfterMs = last?.nudgeAfterMs,
            loaded = true,
        )
    }

    override fun onEvent(data: JsonElement) {
        val change = decodeOrNull(RemoteAgentsEvent.serializer(), data) ?: return
        val now = mutable.value
        val byId = now.rows.associateBy { it.id }.toMutableMap()
        change.removed?.forEach { byId.remove(it) }
        change.upsert?.forEach { row -> if (known(row)) byId[row.id] = row else byId.remove(row.id) }
        mutable.value = now.copy(rows = byId.values.toList(), unavailable = change.unavailable ?: now.unavailable)
    }

    private fun known(row: RemoteAgentRow) = RemoteAgentKind.read(row.kind) != null
}
