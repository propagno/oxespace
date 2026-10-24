import type { ApprovalBroker } from './approval-broker'
import { textHash } from './approval-broker'
import type { ActionAudit, ActionLevel } from './action-audit'

/** A refusal the model can act on; `code` is stable and documented in MCP_AUTOMATION.md. */
export class ActionRefused extends Error {
  constructor(message: string, readonly code: string) { super(message) }
}

export interface ActionActor {
  /** Unique per live execution: grants and rate limits are scoped to it. */
  key: string
  /** `pane:abc` or `thread:abc`, shown in the approval prompt and the audit trail. */
  label: string
  workspaceId: string | null
  /** False for a caller without a live OXESpace execution (a CLI started elsewhere). */
  authenticated: boolean
}

export interface ActionRequest {
  tool: string
  action: string
  level: ActionLevel
  /** For `confirm`: one line naming the change, e.g. "push feat/x to origin". */
  summary?: string
  /** What it applies to: a repository path, a workspace name. */
  target?: string
  /** For `confirm`: exactly what will happen; the approval is bound to its hash. */
  text?: string
  reasons?: string[]
}

export const ACTION_RATE_PER_MINUTE = 30
/** A person approves exactly what they can read; anything longer is refused rather than shortened. */
export const MAX_REVIEWABLE = 6000

/**
 * The policy door for every MCP tool outside OxeQuery. The level comes from the
 * tool's own declaration, never from the model's arguments:
 *
 *   read     runs; not recorded
 *   write    needs a live execution, is rate limited and recorded
 *   confirm  as write, and a person approves the exact text first
 */
export class AgentActions {
  private readonly calls = new Map<string, number[]>()
  private readonly now: () => number

  constructor(private readonly deps: { broker?: ApprovalBroker; audit?: ActionAudit; now?: () => number; ratePerMinute?: number } = {}) {
    this.now = deps.now ?? Date.now
  }

  async run<T>(actor: ActionActor, request: ActionRequest, perform: () => Promise<T>): Promise<T> {
    if (request.level === 'read') return perform()
    if (!actor.authenticated) throw new ActionRefused('This action changes OXESpace, so it must come from an agent running inside OXESpace (a Code pane or a Thread).', 'no-execution')
    this.limit(actor)
    const text = request.text ?? `${request.action}${request.target ? ` on ${request.target}` : ''}`
    const hash = textHash(text)
    const base = { actor: actor.label, workspaceId: actor.workspaceId, tool: request.tool, action: request.action, level: request.level, textHash: hash, text }
    let decision: 'auto' | 'approved' = 'auto'
    if (request.level === 'confirm') {
      if (text.length > MAX_REVIEWABLE) throw new ActionRefused(`This request is longer than ${MAX_REVIEWABLE} characters, which is more than a person can review. Split it into smaller steps.`, 'too-long')
      const broker = this.deps.broker
      const state = broker
        ? await broker.require(actor.key, `${request.tool}|${request.target ?? ''}`, {
          actor: actor.label, tool: `${request.tool}.${request.action}`, title: 'OXESpace — request from an agent',
          summary: `${actor.label} wants to ${request.summary ?? request.action}`, target: request.target ?? '', risk: 'action', text, reasons: request.reasons ?? []
        })
        : { state: 'denied' as const }
      if (state.state === 'denied') {
        this.deps.audit?.record({ ...base, decision: 'denied', outcome: 'skipped', errorCode: 'denied' })
        throw new ActionRefused('The person declined this request. Do not retry it unchanged.', 'denied')
      }
      if (state.state === 'pending') {
        this.deps.audit?.record({ ...base, decision: 'pending', outcome: 'skipped', errorCode: 'approval-pending' })
        throw new ActionRefused('Waiting for the person to approve this request in OXESpace. Ask them to approve it, then call this tool again with exactly the same arguments.', 'approval-pending')
      }
      decision = 'approved'
    }
    const started = this.now()
    try {
      const result = await perform()
      this.deps.audit?.record({ ...base, decision, outcome: 'ok', durationMs: this.now() - started })
      return result
    } catch (error) {
      this.deps.audit?.record({ ...base, decision, outcome: 'error', durationMs: this.now() - started, errorCode: error instanceof ActionRefused ? error.code : 'failed' })
      throw error
    }
  }

  private limit(actor: ActionActor): void {
    const now = this.now()
    const recent = (this.calls.get(actor.key) ?? []).filter(at => now - at < 60_000)
    if (recent.length >= (this.deps.ratePerMinute ?? ACTION_RATE_PER_MINUTE)) {
      this.calls.set(actor.key, recent)
      throw new ActionRefused('Too many changes in the last minute. Wait before trying again.', 'rate-limited')
    }
    recent.push(now)
    this.calls.set(actor.key, recent)
  }
}
