import type { AgentHostDecision } from '../../../../shared/types/agent-permissions'
import type { ThreadAuditEntry, ThreadConfiguration, ThreadPermissionRule, ThreadRequest, ThreadRequestPolicy, ThreadRequestResponse } from '../../../../shared/types/thread'
import { fullAccessPolicy } from './kernel/permission-policy'
import type { ThreadPermissionStore } from './thread-permissions'
import { policyBlockedMessage } from '../../../../shared/policy'
import { policyStore } from '../policy'
import { OXESPACE_BRIDGE_KEY } from './read-only-mcp-tools'
import { activeHostDecision } from '../approvals/agent-permissions'
import { requestImpact } from '../approvals/request-impact'
import { alwaysAllowOffer } from '../approvals/always-allow'
import { parseHttpCalls } from '../http-audit/parse'

const BRIDGE_PREFIX = `mcp__${OXESPACE_BRIDGE_KEY}__`

type AuditInput = Omit<ThreadAuditEntry, 'id' | 'at' | 'threadId' | 'projectRoot'>

/** What an approval was about, for the audit trail. */
export function requestSubject(request: ThreadRequest): string {
  if (request.command) return `command: ${request.command.slice(0, 500)}`
  if (request.paths?.length) return `${request.toolName ?? 'edit'}: ${request.paths.join(', ').slice(0, 500)}`
  return request.title
}

/**
 * The permission rules that answer a conversation's approvals, and the audit trail of every decision, seen from
 * one conversation: rules and records are scoped by the project the conversation works in.
 */
export class ThreadPolicy {
  constructor(
    private readonly permissions: ThreadPermissionStore,
    /** The project root of a conversation; throws for one that does not exist. */
    private readonly rootOf: (id: string) => string,
    private readonly resolve: (id: string, requestId: string, generation: number, response: ThreadRequestResponse) => Promise<unknown>,
    private readonly hostDecisionFor: (rootPath: string, host: string) => AgentHostDecision = activeHostDecision
  ) {}

  /** The rules' answer to a request, combined with the conversation's access level. */
  evaluate(rootPath: string, request: ThreadRequest, access?: ThreadConfiguration['access']) {
    if (request.kind === 'approval' && !request.impact) {
      request.impact = requestImpact(request, { root: rootPath })
    }
    if (request.kind === 'approval' && request.command && !request.alwaysAllow) {
      const provider = request.nativeMethod?.startsWith('item/') ? 'codex' : 'claude'
      request.alwaysAllow = alwaysAllowOffer(request, provider)
    }
    // Organization policy first: a tool it blocks is declined, whatever the saved rules or the access level say. An
    // OXESpace tool also answers to `mcp__oxespace__…`, its name in Code terminals, as at tools/call (SECURITY #547 L2).
    const names = request.toolName ? [request.toolName, ...(request.toolName.startsWith(BRIDGE_PREFIX) ? [`mcp__oxespace__${request.toolName.slice(BRIDGE_PREFIX.length)}`] : [])] : []
    const store = names.length ? policyStore() : null
    const organization = store ? names.map(name => store.decide('tool.use', name, rootPath)).find(verdict => !verdict.allowed) : undefined
    if (organization && !organization.allowed) return { decision: 'deny' as const, reasons: [policyBlockedMessage(organization, request.toolName!)] }

    let hostMustAsk: string | undefined
    if (request.kind === 'approval' && request.command) {
      const shell = /^(powershell|pwsh)$/i.test(request.toolName ?? '') ? 'powershell' : 'bash'
      for (const call of parseHttpCalls(request.command, shell)) {
        if (!call.host) continue
        const verdict = this.hostDecisionFor(rootPath, call.host)
        if (verdict === 'deny') {
          return { decision: 'deny' as const, reasons: [`HTTP host ${call.host} is blocked.`] }
        }
        if (verdict === 'ask' && !hostMustAsk) hostMustAsk = call.host
      }
    }

    let policy: ThreadRequestPolicy | undefined
    try { policy = this.permissions.evaluate(rootPath, request) } catch { policy = undefined }
    const combined = fullAccessPolicy(request, policy, access)
    if (combined?.decision === 'deny') return combined
    if (hostMustAsk) {
      return {
        ...(combined ?? { reasons: [] }),
        decision: 'ask' as const,
        guarded: true as const,
        reasons: [`HTTP host ${hostMustAsk} requires approval first.`, ...(combined?.reasons ?? [])]
      }
    }
    return combined
  }

  /** Answers a request the permission rules decided; on any failure the person still sees the prompt. */
  async apply(id: string, request: ThreadRequest): Promise<void> {
    const policy = request.policy!, allow = policy.decision === 'allow', decision = allow ? 'accept' as const : 'decline' as const
    if (request.availableDecisions && !request.availableDecisions.includes(decision)) return
    try {
      await this.resolve(id, request.id, request.generation, allow ? { decision } : { decision, reason: `Blocked by an OXESpace permission rule. ${policy.reasons.join(' ')}`.trim() })
      this.audit(id, { action: 'policy', actor: 'policy', summary: `${allow ? 'Allowed' : 'Declined'} ${requestSubject(request)}`, detail: policy.reasons.join('\n') })
    } catch { /* Still pending: the person answers it. */ }
  }

  /** Records a decision; auditing never interrupts the action it describes. */
  audit(id: string, entry: AuditInput): void {
    try { this.permissions.audit({ ...entry, threadId: id, projectRoot: this.rootOf(id) }) } catch { /* best effort */ }
  }

  /** Rules that answer this conversation's approvals: its project's and the global ones. */
  rules(id: string): ThreadPermissionRule[] {
    return this.permissions.rules(this.rootOf(id))
  }

  addRule(id: string, input: { kind: ThreadPermissionRule['kind']; pattern: string; decision: ThreadPermissionRule['decision']; scope: 'project' | 'global' }): ThreadPermissionRule {
    const rootPath = this.rootOf(id)
    const rule = this.permissions.add({ projectRoot: input.scope === 'global' ? null : rootPath, kind: input.kind, pattern: input.pattern, decision: input.decision })
    this.audit(id, { action: 'rule-added', actor: 'user', summary: `${rule.decision === 'allow' ? 'Allow' : 'Deny'} ${rule.kind} ${rule.pattern}${rule.projectRoot ? '' : ' (all projects)'}` })
    return rule
  }

  removeRule(id: string, ruleId: string): void {
    const rootPath = this.rootOf(id)
    const rule = this.permissions.rules(rootPath).find(value => value.id === ruleId)
    if (!rule) throw Error('That rule does not apply to this project')
    this.permissions.remove(ruleId)
    this.audit(id, { action: 'rule-removed', actor: 'user', summary: `Removed ${rule.decision} ${rule.kind} ${rule.pattern}${rule.projectRoot ? '' : ' (all projects)'}` })
  }

  autoApproveReads(): boolean { return this.permissions.autoApproveReads() }

  setAutoApproveReads(enabled: boolean): boolean {
    const value = this.permissions.setAutoApproveReads(enabled)
    this.permissions.audit({ action: 'configuration', actor: 'user', summary: value ? 'Approve read-only commands automatically: on' : 'Approve read-only commands automatically: off' })
    return value
  }

  auditLog(id: string, options: { scope?: 'thread' | 'project'; before?: number; limit?: number } = {}): ThreadAuditEntry[] {
    const rootPath = this.rootOf(id)
    return this.permissions.auditLog(options.scope === 'project' ? { projectRoot: rootPath, before: options.before, limit: options.limit } : { threadId: id, before: options.before, limit: options.limit })
  }
}
