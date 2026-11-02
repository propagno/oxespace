package com.oxespace.mobile.approval

import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteRespondRequestArgs
import com.oxespace.mobile.protocol.live.CommandResult

/** Asks the person to prove it's them, on this phone, for one request they have read in full. */
fun interface ApprovalGate {
    suspend fun confirm(request: RemotePendingRequest, decision: String?): Boolean
}

/** Why an answer didn't go out; each has its own words on screen. */
enum class AnswerBlock {
    /** Only the desktop can answer this request (guarded, permissions, secret questions…). */
    DESKTOP_ONLY,
    /** A decision the desktop didn't offer for this request. */
    NOT_OFFERED,
    /** The person cancelled the biometric prompt or it failed: nothing was sent. */
    NOT_CONFIRMED,
    /** The phone wasn't shown all of the request: it can only be declined here, and a question only on the desktop. */
    TRUNCATED,
}

sealed interface AnswerOutcome {
    data class Blocked(val reason: AnswerBlock) : AnswerOutcome
    data class Sent(val result: CommandResult) : AnswerOutcome
}

/**
 * Answers a Thread request from the phone. The rules hold before anything reaches the desktop: only requests the
 * desktop marked answerable, only the decisions it offered, never acceptForSession, never an approval or an answer to
 * a request the phone wasn't shown in full (`truncated`), and only after the person
 * confirmed with biometrics or the device credential. The desktop checks id and generation again (B1.1).
 */
class RequestResponder(
    private val gate: ApprovalGate,
    private val respond: suspend (RemoteRespondRequestArgs) -> CommandResult,
) {
    suspend fun answer(
        request: RemotePendingRequest,
        decision: String? = null,
        answers: Map<String, List<String>>? = null,
        reason: String? = null,
    ): AnswerOutcome {
        // The desktop already offers no accept and makes a truncated question unanswerable; this holds even if it didn't.
        if (request.truncated == true && ((decision != "decline" && decision != "cancel") || answers != null)) return AnswerOutcome.Blocked(AnswerBlock.TRUNCATED)
        if (!request.answerable) return AnswerOutcome.Blocked(AnswerBlock.DESKTOP_ONLY)
        if (decision != null && (decision !in request.decisions || decision == "acceptForSession")) return AnswerOutcome.Blocked(AnswerBlock.NOT_OFFERED)
        if (decision == null && answers.isNullOrEmpty()) return AnswerOutcome.Blocked(AnswerBlock.NOT_OFFERED)
        if (!gate.confirm(request, decision)) return AnswerOutcome.Blocked(AnswerBlock.NOT_CONFIRMED)
        val args = RemoteRespondRequestArgs(
            threadId = request.threadId,
            requestId = request.requestId,
            generation = request.generation,
            response = RemoteRespondRequestArgs.Response(decision = decision, answers = answers, reason = reason?.takeIf { it.isNotBlank() }),
        )
        return AnswerOutcome.Sent(respond(args))
    }
}
