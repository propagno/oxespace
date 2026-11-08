@file:Suppress("UNUSED_PARAMETER", "unused")

package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemotePane
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/*
 * 1.5.0 F10 API skeleton (A46, CR-34), no behaviour; MOB-A46 and MOB-CR34 replace the TODOs.
 * CCRs: docs/roadmap-1.5/ccr-phone-pane-conversation.md (#658), ccr-phone-terminal.md (#691) T-P3.3.
 * Tests: PaneConversationTest, PaneHiddenTest, androidTest PaneConversationOnDeviceTest.
 */

/** One text message of a pane agent's conversation; `id` is stable (`native:<uuid>`), the merge key. */
data class ConversationItem(val id: String, val role: String, val text: String)

/** A page, oldest to newest; [cursor] for "Load earlier", null at the oldest; [epoch] bumps on a new session. */
data class ConversationPage(val items: List<ConversationItem>, val cursor: String?, val epoch: Long)

/** What a `pane.conversation` fetch gave. */
sealed interface ConversationFetch {
    data class Page(val page: ConversationPage) : ConversationFetch
    /** `conversation-changed`, with its reason (`new-session`, `rewritten`, or one added later). */
    data class Changed(val reason: String?) : ConversationFetch
    data object NoConversation : ConversationFetch
}

data class PaneConversationState(
    val items: List<ConversationItem> = emptyList(),
    val olderCursor: String? = null,
    val newConversation: Boolean = false,
    val unavailable: Boolean = false,
    /** The Latest chip's count; null after a gap (no overlap, or a new epoch). */
    val newCount: Int? = 0,
    /** CR-34: the desktop hid this pane from the phone. */
    val hiddenOnDesktop: Boolean = false,
)

/** A pane agent's conversation on the phone: merge by id, Load earlier, coalesced fetches, follow at the bottom. */
class PaneConversation(scope: CoroutineScope, fetch: suspend (cursor: String?) -> ConversationFetch) {
    val state: StateFlow<PaneConversationState> get() = TODO("F10 A46")

    fun onSnapshot(page: ConversationPage) {
        TODO("F10 A46")
    }

    fun onChanged() {
        TODO("F10 A46")
    }

    fun loadEarlier() {
        TODO("F10 A46")
    }

    fun seen() {
        TODO("F10 A46")
    }

    fun follow(atBottom: Boolean): Boolean = TODO("F10 A46")

    fun onHidden() {
        TODO("F10 CR34")
    }
}

/** The Screen · Conversation toggle shows only when the desktop says the pane has a conversation. */
fun showsConversationToggle(pane: RemotePane): Boolean = TODO("F10 A46")
