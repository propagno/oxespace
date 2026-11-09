package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteFrames
import org.junit.Assert.assertEquals
import org.junit.Test

/** 1.5.0 F10 CR-F10-7: how a `pane.conversation` command's outcome reads in the store. */
class ConversationFetchTest {
    private val page = RemoteFrames.json.parseToJsonElement(
        """{"agent":"claude","items":[{"seq":1,"item":{"type":"message","id":"native:1","role":"assistant","text":"hi"}}],"cursor":"c-1","epoch":2}""",
    )

    @Test
    fun anAnswerWithAPageIsThatPage() {
        assertEquals(
            ConversationFetch.Page(ConversationPage(listOf(ConversationItem("native:1", "assistant", "hi")), "c-1", 2)),
            conversationFetchOf(CommandResult.Done(page)),
        )
    }

    @Test
    fun conversationChangedReloadsWithItsReason() {
        assertEquals(ConversationFetch.Changed("new-session"), conversationFetchOf(CommandResult.Refused(RemoteErrorCode.CONVERSATION_CHANGED, reason = "new-session")))
        assertEquals(ConversationFetch.Changed(null), conversationFetchOf(CommandResult.Refused(RemoteErrorCode.CONVERSATION_CHANGED)))
    }

    @Test
    fun anythingElseIsTheNotice() {
        for (result in listOf(
            CommandResult.Refused(RemoteErrorCode.NO_CONVERSATION),
            CommandResult.Refused(RemoteErrorCode.PANE_NOT_SHARED),
            CommandResult.Offline,
            CommandResult.NoAnswer,
            CommandResult.Done(null),
            CommandResult.Done(RemoteFrames.json.parseToJsonElement("""{"not":"a page"}""")),
        )) {
            assertEquals(result.toString(), ConversationFetch.NoConversation, conversationFetchOf(result))
        }
    }
}
