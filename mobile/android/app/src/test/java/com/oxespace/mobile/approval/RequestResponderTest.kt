package com.oxespace.mobile.approval

import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteRespondRequestArgs
import com.oxespace.mobile.protocol.live.CommandResult
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestResponderTest {
    private val request = RemotePendingRequest(
        threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = "r-1", generation = 4,
        kind = "approval", title = "Run npm test", command = "npm test", decisions = listOf("accept", "decline"),
        answerable = true, createdAt = 1,
    )
    private val sent = mutableListOf<RemoteRespondRequestArgs>()
    private val confirmations = mutableListOf<String?>()

    private fun responder(confirm: Boolean) = RequestResponder(
        gate = { _, decision -> confirmations += decision; confirm },
        respond = { sent += it; CommandResult.Done(null) },
    )

    @Test
    fun answersWithIdAndGenerationOnlyAfterTheBiometricConfirmation() = runBlocking {
        val outcome = responder(confirm = true).answer(request, decision = "accept")
        assertEquals(AnswerOutcome.Sent(CommandResult.Done(null)), outcome)
        assertEquals(listOf<String?>("accept"), confirmations)
        assertEquals(RemoteRespondRequestArgs("t-1", "r-1", 4, RemoteRespondRequestArgs.Response(decision = "accept")), sent.single())
    }

    @Test
    fun sendsNothingWhenThePersonDoesNotConfirm() = runBlocking {
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.NOT_CONFIRMED), responder(confirm = false).answer(request, decision = "decline"))
        assertTrue(sent.isEmpty())
    }

    @Test
    fun neverAsksForWhatOnlyTheDesktopCanAnswerOrWasNotOffered() = runBlocking {
        val responder = responder(confirm = true)
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.DESKTOP_ONLY), responder.answer(request.copy(answerable = false), decision = "accept"))
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.NOT_OFFERED), responder.answer(request, decision = "cancel"))
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.NOT_OFFERED), responder.answer(request.copy(decisions = request.decisions + "acceptForSession"), decision = "acceptForSession"))
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.NOT_OFFERED), responder.answer(request))
        // The gate is not even shown for a request the phone may not answer.
        assertTrue(confirmations.isEmpty())
        assertTrue(sent.isEmpty())
    }

    @Test
    fun aRequestThePhoneWasNotShownInFullCanOnlyBeDeclined() = runBlocking {
        val responder = responder(confirm = true)
        // Even if the desktop offered accept on a truncated approval, the phone never sends it.
        val cut = request.copy(truncated = true)
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.TRUNCATED), responder.answer(cut, decision = "accept"))
        assertTrue(confirmations.isEmpty())
        assertEquals(AnswerOutcome.Sent(CommandResult.Done(null)), responder.answer(cut.copy(decisions = listOf("decline")), decision = "decline"))
        // A decline carries no answers for what the phone wasn't shown in full (SECURITY #422).
        assertEquals(
            AnswerOutcome.Blocked(AnswerBlock.TRUNCATED),
            responder.answer(cut.copy(decisions = listOf("decline")), decision = "decline", answers = mapOf("q" to listOf("yes"))),
        )
        assertEquals("decline", sent.single().response.decision)
        // A truncated question offers nothing to answer here, whatever its other fields say.
        val question = request.copy(kind = "question", decisions = emptyList(), truncated = true)
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.TRUNCATED), responder.answer(question, answers = mapOf("q1" to listOf("Yes"))))
        assertEquals(1, sent.size)
    }

    @Test
    fun answersQuestionsAndKeepsAReasonOnlyWhenGiven() = runBlocking {
        val question = request.copy(kind = "question", decisions = emptyList())
        responder(confirm = true).answer(question, answers = mapOf("q1" to listOf("Yes")), reason = "  ")
        assertEquals(RemoteRespondRequestArgs.Response(answers = mapOf("q1" to listOf("Yes"))), sent.single().response)
    }
}
