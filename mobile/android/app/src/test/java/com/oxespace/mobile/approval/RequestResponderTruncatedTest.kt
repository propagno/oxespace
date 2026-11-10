package com.oxespace.mobile.approval

import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteRespondRequestArgs
import com.oxespace.mobile.protocol.live.CommandResult
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 CR-F10-3 (A44, OXE program, phase F10). Written by the planner; the executor must not
 * edit it. TECH LEAD's ruling (08/11): a request the phone wasn't shown in full can only be refused — Deny, never
 * Cancel. The screen stops offering Cancel there (RequestScreenActionsOnDeviceTest); RequestResponder enforces the same
 * rule on its own, before anything reaches the gate or the desktop, as it does for Allow.
 *
 * Red at T4 (f877342d): RequestResponder lets `cancel` through on a truncated request
 * (`decision != "decline" && decision != "cancel"`).
 */
class RequestResponderTruncatedTest {
    private val request = RemotePendingRequest(
        threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = "r-1", generation = 4,
        kind = "approval", title = "Run npm test", command = "npm test", decisions = listOf("accept", "decline", "cancel"),
        answerable = true, createdAt = 1, truncated = true,
    )
    private val sent = mutableListOf<RemoteRespondRequestArgs>()
    private val confirmations = mutableListOf<String?>()
    private val responder = RequestResponder(
        gate = { _, decision -> confirmations += decision; true },
        respond = { sent += it; CommandResult.Done(null) },
    )

    @Test
    fun aTruncatedRequestRefusesCancelBeforeTheGate() = runBlocking {
        assertEquals(AnswerOutcome.Blocked(AnswerBlock.TRUNCATED), responder.answer(request, decision = "cancel"))
        assertTrue("the biometric sheet is never shown for it", confirmations.isEmpty())
        assertTrue("nothing reaches the desktop", sent.isEmpty())
    }

    @Test
    fun denyStillGoesThroughTheGateOnATruncatedRequest() = runBlocking {
        assertEquals(AnswerOutcome.Sent(CommandResult.Done(null)), responder.answer(request, decision = "decline"))
        assertEquals(listOf<String?>("decline"), confirmations)
        assertEquals("decline", sent.single().response.decision)
    }
}
