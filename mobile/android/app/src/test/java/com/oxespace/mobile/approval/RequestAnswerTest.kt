package com.oxespace.mobile.approval

import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteRespondRequestArgs
import com.oxespace.mobile.protocol.live.CommandResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A44 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-phone-screens.md (#688), the safe answers HML asked for in M10. `RequestResponder`'s 1.4
 * rules stay in RequestResponderTest; this adds what a busy desktop and a hurried thumb can do to one answer.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RequestAnswerTest {
    private val request = RemotePendingRequest(
        threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = "r-1", generation = 4,
        kind = "approval", title = "Run npm test", command = "npm test", decisions = listOf("accept", "decline"),
        answerable = true, createdAt = 1,
    )
    private val sent = mutableListOf<RemoteRespondRequestArgs>()
    private val confirmations = mutableListOf<String?>()

    private fun responder(
        gate: ApprovalGate = ApprovalGate { _, decision -> confirmations += decision; true },
        result: CommandResult = CommandResult.Done(null),
    ) = RequestResponder(gate = gate, respond = { sent += it; result })

    @Test
    fun everyAnswerDeclineIncludedPassesTheBiometricFirst() = runTest {
        val responder = responder()
        responder.answer(request, decision = "decline")
        assertEquals(listOf<String?>("decline"), confirmations)
        assertEquals(1, sent.size)
    }

    @Test
    fun aBiometricThatIsCancelledOrUnavailableSendsNothing() = runTest {
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.NOT_CONFIRMED), responder(gate = { _, _ -> false }).answer(request, decision = "decline"))
        // No enrolled biometric and no device credential: the gate can't even be shown. That is "not confirmed" too.
        val unavailable = ApprovalGate { _, _ -> throw IllegalStateException("no biometric or credential enrolled") }
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.NOT_CONFIRMED), responder(gate = unavailable).answer(request, decision = "decline"))
        assertTrue(sent.isEmpty())
    }

    @Test
    fun theDesktopAnsweredFirstSoThePhoneSaysAlreadyAnsweredAndSendsNothingMore() = runTest {
        for (code in listOf(RemoteErrorCode.NOT_PENDING, RemoteErrorCode.STALE_GENERATION)) {
            sent.clear()
            val outcome = responder(result = CommandResult.Refused(code)).answer(request, decision = "accept")
            assertEquals(code.name, AnswerNotice.ALREADY_ANSWERED, answerNotice(outcome))
            assertEquals(code.name, 1, sent.size)
        }
        assertNull(answerNotice(AnswerOutcome.Sent(CommandResult.Done(null))))
    }

    @Test
    fun aDoubleTapIsOneAnswer() = runTest {
        val proved = CompletableDeferred<Boolean>()
        val responder = responder(gate = { _, decision -> confirmations += decision; proved.await() })
        val first = async { responder.answer(request, decision = "accept") }
        runCurrent()
        // The second tap lands while the biometric sheet of the first is still up.
        val second = async { responder.answer(request, decision = "accept") }
        runCurrent()
        proved.complete(true)
        assertEquals(AnswerOutcome.Sent(CommandResult.Done(null)), first.await())
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.IN_FLIGHT), second.await())
        assertEquals(listOf<String?>("accept"), confirmations)
        assertEquals(1, sent.size)
    }

    @Test
    fun aRequestAlreadyAnsweredFromThisPhoneIsNotAnsweredAgain() = runTest {
        // An offline phone gets the request from the replayed snapshot on reconnect. It can answer it exactly once:
        // a second answer to the same id and generation never reaches the gate or the desktop.
        val responder = responder()
        assertEquals(AnswerOutcome.Sent(CommandResult.Done(null)), responder.answer(request, decision = "accept"))
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.ALREADY_ANSWERED), responder.answer(request, decision = "decline"))
        assertEquals(1, confirmations.size)
        assertEquals(1, sent.size)
        // A new generation of the same request is a new question, and can be answered.
        assertEquals(AnswerOutcome.Sent(CommandResult.Done(null)), responder.answer(request.copy(generation = 5), decision = "decline"))
        assertEquals(2, sent.size)
    }

    @Test
    fun anAnswerThatNeverLeftThePhoneCanBeTriedAgain() = runTest {
        // Offline means nothing was sent, so it doesn't count as the one answer.
        val offline = responder(result = CommandResult.Offline)
        assertEquals(AnswerOutcome.Sent(CommandResult.Offline), offline.answer(request, decision = "accept"))
        assertEquals(AnswerOutcome.Sent(CommandResult.Offline), offline.answer(request, decision = "accept"))
        assertEquals(2, confirmations.size)
    }

    @Test
    fun allowAtCriticalRiskWaitsTheDesktopsTwoSecondHold() {
        assertEquals(2_000L, allowHoldMs(request.copy(risk = "critical")))
        for (risk in listOf(null, "low", "medium", "high")) assertEquals(risk.toString(), 0L, allowHoldMs(request.copy(risk = risk)))
    }
}
