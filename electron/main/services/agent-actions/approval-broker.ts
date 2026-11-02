import { createHash, randomUUID } from 'node:crypto'
import type { ApprovalPresentation } from '../approvals/drafts'
import type { MainMessage } from '../../../../shared/messages'
import { onExecutionEnded } from '../execution-registry'

export type ApprovalDecision = 'allow-once' | 'allow-session' | 'deny'
export type ApprovalRisk = 'read' | 'write' | 'action'

/**
 * What the person is asked, through the approval center (B10). `risk` is the broker's own scope (reads may be allowed for
 * the run); `level` is the risk the person sees. Title, summary and notes are C3 codes; `text` is exactly what will run.
 */
export interface ApprovalRequest extends ApprovalPresentation {
  id: string
  /** Who is asking, for the audit trail (`pane:abc`, `thread:abc`); the person sees `requester`. */
  actor: string
  tool: string
  risk: ApprovalRisk
  /** Exactly what will run. */
  text: string
  hash: string
  expiresAt: number
}

/** Shows a request to the person and returns their decision. The app's is the approval center (approval-prompter.ts). */
export interface ApprovalPrompter {
  ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>
}

/**
 * Thrown by a prompter when the request was never shown (the queue was full): the agent is told why and may retry
 * later, so it is not remembered as the person's denial.
 */
export class PrompterRefusal extends Error {
  constructor(readonly refusal: MainMessage) { super(refusal.code) }
}

export type ApprovalState =
  | { state: 'approved'; via: 'once' | 'session' }
  | { state: 'denied' }
  | { state: 'refused'; refusal: MainMessage }
  | { state: 'pending'; requestId: string }

export const APPROVAL_TTL_MS = 5 * 60_000
const DENY_MEMORY_MS = 60_000
/** "Allow reads for this run" ends with the execution (endExecution), and lapses on its own after this anyway. */
const SESSION_READ_TTL_MS = 4 * 60 * 60_000

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

interface Pending { requestId: string; promise: Promise<ApprovalDecision | PrompterRefusal>; controller: AbortController; endedBy?: 'execution' }

/** Ended executions remembered, so a call authenticated just before its pane closed cannot raise a new ask. */
const ENDED_MEMORY = 256

/**
 * Decides whether an agent may run a statement. A grant is bound to the execution,
 * the connection, the tool and the SHA-256 of the exact text, is single use and
 * expires; changing one character asks again. "Allow for this session" exists
 * for reads only.
 */
export class ApprovalBroker {
  private readonly grants = new Map<string, number>()
  private readonly denials = new Map<string, number>()
  private readonly sessionReads = new Map<string, number>()
  private readonly pending = new Map<string, Pending>()
  private readonly ended = new Set<string>()
  private readonly unsubscribe: () => void

  constructor(private readonly prompter: ApprovalPrompter | undefined, private readonly now: () => number = Date.now, private readonly defaultWaitMs = 45_000,
    executionEnded: (listener: (execution: { id: string }) => void) => unknown = onExecutionEnded) {
    // B23: the actor key is the execution id, so an ended execution's asks and grants end with it.
    const stop = executionEnded(execution => this.endExecution(execution.id))
    this.unsubscribe = typeof stop === 'function' ? stop as () => void : () => {}
  }

  /** Stops listening for ended executions (a broker that is thrown away, in tests). */
  dispose(): void { this.unsubscribe() }

  private key(executionKey: string, scope: string, tool: string, hash: string): string {
    return `${executionKey}|${scope}|${tool}|${hash}`
  }

  private expireSessionReads(now: number): void {
    for (const [key, at] of this.sessionReads) if (now - at > SESSION_READ_TTL_MS) this.sessionReads.delete(key)
  }

  /**
   * The execution ended (its pane closed or exited, its session ended or was replaced): cancel what it is still asking,
   * so the person is not left with a request nobody waits for (the center closes it, native dialog included, as
   * `approvals.denied.cancelled`), and forget what it was granted.
   */
  endExecution(executionKey: string): void {
    this.ended.add(executionKey)
    if (this.ended.size > ENDED_MEMORY) this.ended.delete(this.ended.values().next().value!)
    for (const [key, pending] of [...this.pending]) if (key.startsWith(`${executionKey}|`)) {
      this.pending.delete(key)
      pending.endedBy = 'execution'
      pending.controller.abort()
    }
    for (const key of [...this.grants.keys()]) if (key.startsWith(`${executionKey}|`)) this.grants.delete(key)
    for (const key of [...this.sessionReads.keys()]) if (key.startsWith(`${executionKey}|`)) this.sessionReads.delete(key)
  }

  async require(
    executionKey: string,
    scope: string,
    request: Omit<ApprovalRequest, 'id' | 'hash' | 'expiresAt'>,
    waitMs = this.defaultWaitMs
  ): Promise<ApprovalState> {
    const hash = textHash(request.text)
    const key = this.key(executionKey, scope, request.tool, hash)
    const now = this.now()
    this.expireSessionReads(now)
    // Expired grants and denials are dead entries; drop them so a long session does not accumulate them.
    for (const [entry, until] of this.grants) if (until <= now) this.grants.delete(entry)
    for (const [entry, until] of this.denials) if (until <= now) this.denials.delete(entry)
    if (request.risk === 'read' && this.sessionReads.has(`${executionKey}|${scope}|read`)) return { state: 'approved', via: 'session' }
    const granted = this.grants.get(key)
    if (granted !== undefined) {
      this.grants.delete(key)
      if (granted > now) return { state: 'approved', via: 'once' }
    }
    const denied = this.denials.get(key)
    if (denied !== undefined && denied > now) return { state: 'denied' }
    if (!this.prompter) return { state: 'denied' }
    // An ended execution raises nothing new: nobody is left to act on the answer.
    if (this.ended.has(executionKey)) return { state: 'denied' }

    let pending = this.pending.get(key)
    if (!pending) {
      const requestId = randomUUID()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), APPROVAL_TTL_MS)
      const full: ApprovalRequest = { ...request, id: requestId, hash, expiresAt: now + APPROVAL_TTL_MS }
      const entry: Pending = { requestId, controller, promise: undefined as unknown as Pending['promise'] }
      entry.promise = this.prompter.ask(full, controller.signal).catch((error: unknown): ApprovalDecision | PrompterRefusal => error instanceof PrompterRefusal ? error : 'deny').then(decision => {
        clearTimeout(timer)
        // Only this ask's own entry: a newer ask with the same key is never dropped by an older one settling.
        if (this.pending.get(key) === entry) this.pending.delete(key)
        // Cancelled because its execution ended: not the person's decision, so nothing is remembered as one.
        if (entry.endedBy) return 'deny'
        if (decision instanceof PrompterRefusal) return decision
        const at = this.now()
        if (decision === 'deny') this.denials.set(key, at + DENY_MEMORY_MS)
        else {
          this.grants.set(key, at + APPROVAL_TTL_MS)
          if (decision === 'allow-session' && request.risk === 'read') this.sessionReads.set(`${executionKey}|${scope}|read`, this.now())
        }
        return decision
      })
      pending = entry
      this.pending.set(key, pending)
    }
    let waiting: ReturnType<typeof setTimeout> | undefined
    const settled = await Promise.race([pending.promise, new Promise<'wait'>(resolve => { waiting = setTimeout(() => resolve('wait'), waitMs) })])
    clearTimeout(waiting)
    if (settled === 'wait') return { state: 'pending', requestId: pending.requestId }
    if (settled instanceof PrompterRefusal) return { state: 'refused', refusal: settled.refusal }
    if (settled === 'deny') return { state: 'denied' }
    // Approved while the caller was waiting: consume the grant now.
    this.grants.delete(key)
    return { state: 'approved', via: this.sessionReads.has(`${executionKey}|${scope}|read`) && request.risk === 'read' && settled === 'allow-session' ? 'session' : 'once' }
  }
}
