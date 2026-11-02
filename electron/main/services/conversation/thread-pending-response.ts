import { mainMessage } from '../../../../shared/messages'
import { requestOutcome } from '../../../../shared/threadRequestOutcome'
import type { ThreadPendingResponseInput, ThreadPendingResponseResult, ThreadRequest, ThreadRequestResponse } from '../../../../shared/types/thread'
import { ThreadRequestRefusalError } from './thread-request-registry'

export interface PendingRequestResponder {
  respond(id: string, requestId: string, response: ThreadRequestResponse, listedGeneration?: number): Promise<ThreadRequest | undefined>
}

/**
 * Answers a request listed by `pendingRequestsAll`, from any window or device (B1.1). The registry delivers the first
 * answer for the listed generation; a repeated, concurrent, late or stale one comes back as a refusal with its message
 * code, never as a second delivery. Anything else (an unknown conversation, a provider failure) still rejects.
 */
export async function respondPending(responder: PendingRequestResponder, input: ThreadPendingResponseInput): Promise<ThreadPendingResponseResult> {
  try {
    const request = await responder.respond(input.threadId, input.requestId, input.response, input.generation)
    return { ok: true, threadId: input.threadId, requestId: input.requestId, resolution: requestOutcome(request?.kind ?? 'approval', input.response).resolution }
  } catch (error) {
    if (!(error instanceof ThreadRequestRefusalError)) throw error
    return { ok: false, refusal: error.refusal, message: mainMessage(`thread.request.${error.refusal}`, {}) }
  }
}

/** The generation a request was listed under: a non-negative whole number. */
export function listedGeneration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid request generation')
  return value
}
