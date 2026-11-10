package com.oxespace.mobile.approval

import com.oxespace.mobile.protocol.RemoteApprovalRisk
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteRespondRequestArgs
import com.oxespace.mobile.protocol.live.CommandResult
import com.oxespace.mobile.ui.live.riskLevel

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
    /** 1.5.0 A44: an answer to this request is already on its way (a second tap). */
    IN_FLIGHT,
    /** 1.5.0 A44: this phone already answered this request's generation. */
    ALREADY_ANSWERED,
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
 * 1.5.0 A44: one answer per request generation. A second tap while the first is on its way is IN_FLIGHT, and a
 * generation this phone already answered is ALREADY_ANSWERED. Neither reaches the gate.
 */
class RequestResponder(
    private val gate: ApprovalGate,
    private val respond: suspend (RemoteRespondRequestArgs) -> CommandResult,
) {
    /** One question: a request's id in its thread, at one generation. A new generation is a new question. */
    private data class Key(val threadId: String, val requestId: String, val generation: Long)

    private val lock = Any()
    /** Answers between the first tap and the desktop's reply (the biometric sheet included). */
    private val inFlight = mutableSetOf<Key>()
    /** Questions this phone answered: the desktop took the answer, or said it was already answered. */
    private val answered = mutableSetOf<Key>()

    suspend fun answer(
        request: RemotePendingRequest,
        decision: String? = null,
        answers: Map<String, List<String>>? = null,
        reason: String? = null,
    ): AnswerOutcome {
        // The desktop already offers no accept and makes a truncated question unanswerable; this holds even if it didn't.
        // CR-F10-3 (TECH LEAD 08/11): a request the phone wasn't shown in full can only be refused: Deny, never Cancel.
        if (request.truncated == true && (decision != "decline" || answers != null)) return AnswerOutcome.Blocked(AnswerBlock.TRUNCATED)
        if (!request.answerable) return AnswerOutcome.Blocked(AnswerBlock.DESKTOP_ONLY)
        if (decision != null && (decision !in request.decisions || decision == "acceptForSession")) return AnswerOutcome.Blocked(AnswerBlock.NOT_OFFERED)
        if (decision == null && answers.isNullOrEmpty()) return AnswerOutcome.Blocked(AnswerBlock.NOT_OFFERED)
        val key = Key(request.threadId, request.requestId, request.generation)
        // One answer per question: a second tap while the first is on its way, or after it went, never reaches the gate.
        synchronized(lock) {
            if (key in answered) return AnswerOutcome.Blocked(AnswerBlock.ALREADY_ANSWERED)
            if (!inFlight.add(key)) return AnswerOutcome.Blocked(AnswerBlock.IN_FLIGHT)
        }
        try {
            // A gate that can't be shown (no biometric, no device credential) is not a confirmation either.
            val confirmed = try {
                gate.confirm(request, decision)
            } catch (cancelled: kotlin.coroutines.cancellation.CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                false
            }
            if (!confirmed) return AnswerOutcome.Blocked(AnswerBlock.NOT_CONFIRMED)
            val args = RemoteRespondRequestArgs(
                threadId = request.threadId,
                requestId = request.requestId,
                generation = request.generation,
                response = RemoteRespondRequestArgs.Response(decision = decision, answers = answers, reason = reason?.takeIf { it.isNotBlank() }),
            )
            val result = respond(args)
            if (countsAsTheAnswer(result)) synchronized(lock) { answered += key }
            return AnswerOutcome.Sent(result)
        } finally {
            synchronized(lock) { inFlight -= key }
        }
    }

    /**
     * Whether this result used up the question's one answer. An Offline result never left the phone. A NoAnswer
     * result has an unknown fate, and the desktop checks the generation again, so a retry can't answer twice.
     * Other refusals answered nothing.
     */
    private fun countsAsTheAnswer(result: CommandResult): Boolean = when (result) {
        is CommandResult.Done -> true
        is CommandResult.Refused -> result.code == RemoteErrorCode.NOT_PENDING || result.code == RemoteErrorCode.STALE_GENERATION
        CommandResult.Offline, CommandResult.NoAnswer -> false
    }
}

/** What the screen tells the person after an answer the desktop no longer wanted. */
enum class AnswerNotice { ALREADY_ANSWERED }

/** `not-pending` or `stale-generation` from the desktop: the request was already answered elsewhere. */
fun answerNotice(outcome: AnswerOutcome): AnswerNotice? = when (outcome) {
    is AnswerOutcome.Sent -> (outcome.result as? CommandResult.Refused)?.code
        ?.takeIf { it == RemoteErrorCode.NOT_PENDING || it == RemoteErrorCode.STALE_GENERATION }
        ?.let { AnswerNotice.ALREADY_ANSWERED }
    is AnswerOutcome.Blocked -> if (outcome.reason == AnswerBlock.ALREADY_ANSWERED) AnswerNotice.ALREADY_ANSWERED else null
}

/** The desktop's hold on Allow at critical risk (shared/types/approvals APPROVAL_CRITICAL_ALLOW_DELAY_MS). */
const val CRITICAL_ALLOW_HOLD_MS = 2_000L

/**
 * How long Allow waits for a risk as the phone reads it: the desktop's hold at critical (an older desktop's "red" and a
 * level added later read as critical too), nothing otherwise.
 */
fun allowHoldMsFor(risk: String?): Long =
    if (risk != null && riskLevel(risk) == RemoteApprovalRisk.CRITICAL) CRITICAL_ALLOW_HOLD_MS else 0L

/** How long Allow waits before it can be pressed: the desktop's 2 s hold at critical, nothing otherwise. */
fun allowHoldMs(request: RemotePendingRequest): Long = allowHoldMsFor(request.risk)
