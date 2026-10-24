import { createHash, randomUUID } from 'node:crypto'

export type ApprovalDecision = 'allow-once' | 'allow-session' | 'deny'
export type ApprovalRisk = 'read' | 'write' | 'action'

export interface ApprovalRequest {
  id: string
  /** Who is asking, for the prompt. */
  actor: string
  tool: string
  /** Dialog title, e.g. "OxeQuery — request from an agent". */
  title: string
  /** One line naming what the actor wants, e.g. "thread:t1 wants to push to origin". */
  summary: string
  /** What it applies to, shown above the text: a connection, a repository, a workspace. */
  target: string
  /** Label of the "allow for this run" button, offered for reads only. */
  sessionLabel?: string
  risk: ApprovalRisk
  /** Exactly what will run. */
  text: string
  hash: string
  /** Extra warnings shown with the text. */
  reasons: string[]
  expiresAt: number
}

/** Shows a request to the person and returns their decision. Implemented with a native dialog in the app. */
export interface ApprovalPrompter {
  ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>
}

export type ApprovalState =
  | { state: 'approved'; via: 'once' | 'session' }
  | { state: 'denied' }
  | { state: 'pending'; requestId: string }

export const APPROVAL_TTL_MS = 5 * 60_000
const DENY_MEMORY_MS = 60_000
/** "Allow reads for this run" lapses on its own: the broker is not told when an execution ends. */
const SESSION_READ_TTL_MS = 4 * 60 * 60_000

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

interface Pending { requestId: string; promise: Promise<ApprovalDecision> }

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

  constructor(private readonly prompter: ApprovalPrompter | undefined, private readonly now: () => number = Date.now, private readonly defaultWaitMs = 45_000) {}

  private key(executionKey: string, scope: string, tool: string, hash: string): string {
    return `${executionKey}|${scope}|${tool}|${hash}`
  }

  private expireSessionReads(now: number): void {
    for (const [key, at] of this.sessionReads) if (now - at > SESSION_READ_TTL_MS) this.sessionReads.delete(key)
  }

  /** Forget everything an execution was granted (it ended). */
  endExecution(executionKey: string): void {
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

    let pending = this.pending.get(key)
    if (!pending) {
      const requestId = randomUUID()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), APPROVAL_TTL_MS)
      const full: ApprovalRequest = { ...request, id: requestId, hash, expiresAt: now + APPROVAL_TTL_MS }
      const promise = this.prompter.ask(full, controller.signal).catch((): ApprovalDecision => 'deny').then(decision => {
        clearTimeout(timer)
        this.pending.delete(key)
        const at = this.now()
        if (decision === 'deny') this.denials.set(key, at + DENY_MEMORY_MS)
        else {
          this.grants.set(key, at + APPROVAL_TTL_MS)
          if (decision === 'allow-session' && request.risk === 'read') this.sessionReads.set(`${executionKey}|${scope}|read`, this.now())
        }
        return decision
      })
      pending = { requestId, promise }
      this.pending.set(key, pending)
    }
    let waiting: ReturnType<typeof setTimeout> | undefined
    const settled = await Promise.race([pending.promise, new Promise<'wait'>(resolve => { waiting = setTimeout(() => resolve('wait'), waitMs) })])
    clearTimeout(waiting)
    if (settled === 'wait') return { state: 'pending', requestId: pending.requestId }
    if (settled === 'deny') return { state: 'denied' }
    // Approved while the caller was waiting: consume the grant now.
    this.grants.delete(key)
    return { state: 'approved', via: this.sessionReads.has(`${executionKey}|${scope}|read`) && request.risk === 'read' && settled === 'allow-session' ? 'session' : 'once' }
  }
}
