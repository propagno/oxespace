import type { ApprovalBroker } from './approval-broker'
import { textHash } from './approval-broker'
import type { ActionAudit, ActionLevel } from './action-audit'
import { englishText } from '../../agent-text'
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import { APPROVAL_AGENT_TEXT_MAX, type ApprovalRequester, type ApprovalRisk } from '../../../../shared/types/approvals'
import { ownerFromLabel, requesterFor } from '../approvals/requester'

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
  /** Who the person sees asking, assigned from the execution's owner (B10); derived from `label` when absent. */
  requester?: ApprovalRequester
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
  /** The app's own warnings, as C3 codes (B10). */
  notes?: MainMessage[]
  /** The risk the person sees; `medium` unless the tool says otherwise. */
  risk?: ApprovalRisk
}

export const ACTION_RATE_PER_MINUTE = 30

/** The MCP code for a request main denied without showing it (B10): the agent may back off and retry a full queue. */
export function refusalCode(refusal: MainMessage): string {
  return refusal.code === 'approvals.denied.queueFull' ? 'queue-full' : refusal.code === 'approvals.denied.tooLong' ? 'too-long' : 'denied'
}
/** A person approves exactly what they can read; anything longer is refused rather than shortened (B10: one cap for every door). */
export const MAX_REVIEWABLE = APPROVAL_AGENT_TEXT_MAX

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
      if ([...text].length > MAX_REVIEWABLE) throw new ActionRefused(englishText(mainMessage('approvals.denied.tooLong', { max: MAX_REVIEWABLE })), 'too-long')
      const owner = ownerFromLabel(actor.label)
      const requester = actor.requester ?? (owner ? requesterFor(owner) : undefined)
      if (!requester) throw new ActionRefused('This action changes OXESpace, so it must come from an agent running inside OXESpace (a Code pane or a Thread).', 'no-execution')
      const target = request.target ?? ''
      const broker = this.deps.broker
      const state = broker
        ? await broker.require(actor.key, `${request.tool}|${request.target ?? ''}`, {
          actor: actor.label, tool: `${request.tool}.${request.action}`, risk: 'action', text,
          kind: 'mcp-confirm', requester, level: request.risk ?? 'medium', title: mainMessage('approvals.title.agent', {}),
          summary: mainMessage('approvals.summary.mcpConfirm', { tool: request.tool, action: request.action, target }), target, notes: request.notes ?? []
        })
        : { state: 'denied' as const }
      if (state.state === 'denied') {
        this.deps.audit?.record({ ...base, decision: 'denied', outcome: 'skipped', errorCode: 'denied' })
        throw new ActionRefused('The person declined this request. Do not retry it unchanged.', 'denied')
      }
      if (state.state === 'refused') {
        this.deps.audit?.record({ ...base, decision: 'refused', outcome: 'skipped', errorCode: refusalCode(state.refusal) })
        throw new ActionRefused(englishText(state.refusal), refusalCode(state.refusal))
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
