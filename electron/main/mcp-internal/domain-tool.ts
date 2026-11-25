import { basename } from 'node:path'
import type { ToolContext, ToolEntry } from './tool-registry'
import { ActionRefused, AgentActions, type ActionActor } from '../services/agent-actions/agent-actions'
import type { ActionLevel } from '../services/agent-actions/action-audit'
import type { AppServices } from './app-services'
import { mainMessage, type MainMessage } from '../../../shared/messages'
import type { ApprovalRisk as BrokerRisk } from '../services/agent-actions/approval-broker'
import type { ApprovalRisk } from '../../../shared/types/approvals'
import { requesterFor } from '../services/approvals/requester'

export type Args = Record<string, unknown>

/** Where a call applies and who made it. */
export interface ActionScope {
  /** The caller's project root: the pane's or Thread's directory, or the workspace root. */
  rootPath: string
  name: string
  workspaceId: string | null
  /** The pane or Thread that is calling, when it is a live execution. */
  owner?: { kind: 'pane' | 'thread'; id: string }
  actor: ActionActor
}

/** `summary` is for the audit trail; the person sees a C3 summary with the tool, action and target, and `notes` (B10). */
export interface Approval {
  summary: string
  text: string
  /** Optional target shown in the modal ("Where") and summary; defaults to `scope.rootPath`. */
  target?: string
  notes?: MainMessage[]
  /** Overrides the broker scope key (e.g. cross-workspace read pair `(sourceWorkspaceId, targetWorkspaceId)`). */
  brokerScope?: string
  /** Broker scope risk (`'read'` allows non-persisted session approval when `risk` is `'low'`). */
  brokerRisk?: BrokerRisk
  /** Risk level shown to the person; defaults to `'medium'`. */
  risk?: ApprovalRisk
  /** Optional custom label for the allow-session button on read approvals. */
  sessionOptionLabel?: MainMessage
  /** Optional explicit explanation returned on denial or missing broker. */
  deniedMessage?: string
}

export interface DomainAction {
  level: ActionLevel
  description: string
  /** JSON-Schema properties this action reads, merged into the tool's schema. */
  properties?: Record<string, unknown>
  required?: string[]
  /**
   * For `confirm`: what the person is asked to approve; it must describe the effect exactly. Returning
   * null skips the question for this call (for example a Thread this caller created): the call is then
   * handled as `write`, still recorded and rate limited. Say when in `approvalNote`.
   * For `read`: optional conditional escalation (e.g. cross-workspace reads); returning null stays `read`,
   * returning an `Approval` escalates this call to `confirm`.
   */
  confirm?: (args: Args, scope: ActionScope, ctx: ToolContext) => Promise<Approval | null> | Approval | null
  /** Replaces "A person approves each call." in the tool description. */
  approvalNote?: string
  run: (args: Args, scope: ActionScope, ctx: ToolContext) => Promise<unknown>
}

/** Without a policy service (tests, or a build that did not wire one), writes still need an execution. */
const fallbackActions = new AgentActions()

/**
 * Resolves the caller. A live execution (a Code pane or a Thread started by
 * OXESpace) is authoritative; a caller without one may only read, scoped to the
 * workspace it names or the active one. A Thread whose execution cannot be
 * verified (it ended, or its credentials do not match) is refused: it never
 * falls back to the active Code workspace, which is not its project (T56).
 */
export async function resolveScope(ctx: ToolContext): Promise<ActionScope> {
  let execution: ReturnType<NonNullable<ToolContext['executions']>['authenticate']> | undefined
  try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) } catch { /* not a live execution */ }
  if (execution) {
    const workspace = execution.workspaceId.startsWith('thread:') ? null : ctx.workspaceServ.get(execution.workspaceId)
    return {
      rootPath: execution.canonicalRoot, name: workspace?.name ?? basename(execution.canonicalRoot), workspaceId: execution.workspaceId, owner: execution.owner,
      actor: { key: execution.id, label: `${execution.owner.kind}:${execution.owner.id}`, workspaceId: execution.workspaceId, authenticated: true, requester: requesterFor(execution.owner) }
    }
  }
  // The same refusal as requireProjectScope (tool-handlers.ts).
  if (ctx.workspaceId?.trim().toLowerCase().startsWith('thread:')) throw new ActionRefused('This Thread execution could not be verified. Start a new turn and try again.', 'no-execution')
  const named = ctx.workspaceId ? ctx.workspaceServ.get(ctx.workspaceId) : null
  const workspace = named ?? ctx.workspaceServ.list().find(item => item.isActive === true) ?? null
  if (!workspace) throw new ActionRefused('No workspace is open in OXESpace. Open the project first.', 'no-workspace')
  return {
    rootPath: workspace.rootPath, name: workspace.name, workspaceId: workspace.id,
    actor: { key: `unauthenticated:${workspace.id}`, label: 'agent', workspaceId: workspace.id, authenticated: false }
  }
}

function reply(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }
}

/**
 * One MCP tool per domain, with an `action` argument. Each action declares its
 * level; the model cannot raise or lower it. The tool list stays short, which
 * keeps every agent's context small.
 */
export function domainTool(name: string, summary: string, actions: Record<string, DomainAction>): ToolEntry {
  const properties: Record<string, unknown> = { action: { type: 'string', enum: Object.keys(actions), description: 'What to do. See the tool description for each action.' } }
  for (const action of Object.values(actions)) Object.assign(properties, action.properties ?? {})
  const lines = Object.entries(actions).map(([key, action]) => {
    const needs = action.level === 'confirm' ? ` ${action.approvalNote ?? 'A person approves each call.'}` : ''
    const required = action.required?.length ? ` Requires: ${action.required.join(', ')}.` : ''
    return `- ${key} (${action.level}): ${action.description}${required}${needs}`
  })
  return {
    descriptor: { name, description: `${summary}\n${lines.join('\n')}`, inputSchema: { type: 'object', properties, required: ['action'], additionalProperties: false } },
    requiresWorkspace: false,
    handler: async (raw, ctx) => {
      const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Args
      const key = typeof args.action === 'string' ? args.action : ''
      const action = Object.hasOwn(actions, key) ? actions[key] : undefined
      if (!action) return reply({ schemaVersion: 1, ok: false, code: 'invalid', message: `action must be one of: ${Object.keys(actions).join(', ')}` }, true)
      try {
        const missing = (action.required ?? []).filter(field => args[field] === undefined || args[field] === null || args[field] === '')
        if (missing.length) throw new ActionRefused(`${key} requires: ${missing.join(', ')}.`, 'invalid')
        const scope = await resolveScope(ctx)
        const approval = action.confirm && (action.level === 'confirm' || action.level === 'read')
          ? await action.confirm(args, scope, ctx)
          : undefined
        const level = action.level === 'confirm' && approval === null
          ? 'write'
          : action.level === 'read' && approval
            ? 'confirm'
            : action.level
        const result = await (ctx.agentActions ?? fallbackActions).run(scope.actor, {
          tool: name, action: key, level,
          target: approval?.target ?? scope.rootPath,
          summary: approval?.summary,
          text: approval?.text,
          notes: approval?.notes,
          brokerScope: approval?.brokerScope,
          brokerRisk: approval?.brokerRisk,
          risk: approval?.risk,
          sessionOptionLabel: approval?.sessionOptionLabel,
          deniedMessage: approval?.deniedMessage
        }, () => action.run(args, scope, ctx))
        return reply({ schemaVersion: 1, ok: true, result })
      } catch (error) {
        if (error instanceof ActionRefused) return reply({ schemaVersion: 1, ok: false, code: error.code, message: error.message }, true)
        return reply({ schemaVersion: 1, ok: false, code: 'failed', message: error instanceof Error ? error.message.slice(0, 500) : 'The operation failed.' }, true)
      }
    }
  }
}

/** The policy door for a tool older than domainTool; a `confirm` shows the person `confirm`'s text. */
export const gated = (tool: string, level: Exclude<ActionLevel, 'read'>, handler: ToolEntry['handler'], confirm?: Gate['confirm']): ToolEntry['handler'] =>
  async (raw, ctx) => (await import('./app-settings-actions')).runGated({ tool, level, handler, confirm }, raw, ctx)
export interface Gate { tool: string; level: Exclude<ActionLevel, 'read'>; handler: ToolEntry['handler']; confirm?: (args: Args, scope: ActionScope) => Promise<Approval> }

/** Argument helpers: a bad argument is the model's to fix, so the message names the field. */
export function str(args: Args, field: string, max = 4096): string | undefined {
  const value = args[field]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new ActionRefused(`${field} must be text of at most ${max} characters.`, 'invalid')
  return value
}

export function int(args: Args, field: string, fallback: number, min: number, max: number): number {
  const value = args[field]
  if (value === undefined || value === null) return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) throw new ActionRefused(`${field} must be a number.`, 'invalid')
  return Math.max(min, Math.min(Math.trunc(number), max))
}

export function bool(args: Args, field: string, fallback: boolean): boolean {
  const value = args[field]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') throw new ActionRefused(`${field} must be true or false.`, 'invalid')
  return value
}

/** Wraps a validation error from the IPC parsers so the model sees the reason. */
export function parsed<T>(parse: () => T): T {
  try { return parse() } catch (error) {
    if (error instanceof ActionRefused) throw error
    throw new ActionRefused(error instanceof Error ? error.message : 'Invalid arguments.', 'invalid')
  }
}

/** A service the tool needs, or a refusal the model can understand. */
export function service<K extends keyof AppServices>(ctx: ToolContext, key: K): NonNullable<AppServices[K]> {
  const value = ctx.app?.[key]
  if (!value) throw new ActionRefused(`This part of OXESpace (${key}) is unavailable right now.`, 'unavailable')
  return value as NonNullable<AppServices[K]>
}

/** Tasks, panes and other workspace features exist only in Code workspaces, not in a Thread's project. */
export function codeWorkspace(scope: ActionScope): string {
  if (!scope.workspaceId || scope.workspaceId.startsWith('thread:')) throw new ActionRefused('This needs a Code workspace. Open the project in Code mode first.', 'no-workspace')
  return scope.workspaceId
}

export interface WorkspaceLike {
  id: string
  name?: string
  rootPath?: string
  panes?: Array<{
    id: string
    displayName?: string | null
    status?: string
    agentProfileId?: string | null
    rootPath?: string | null
    rowIndex?: number
    columnIndex?: number
  }>
}

/** Broker scope key for non-persisted session approval of cross-workspace reads. */
export function crossWorkspaceReadScope(sourceWorkspaceId: string, targetWorkspaceId: string): string {
  return `cross-workspace-read:${sourceWorkspaceId}->${targetWorkspaceId}`
}

/**
 * Resolves the target workspace for a Code-workspace read (`oxespace_agents` list/read, `oxespace_terminal` output).
 * Same-workspace reads stay fast (`crossWorkspace: false`); another workspace requires explicit user authorization.
 */
export function resolveReadableWorkspace(
  args: Args,
  scope: ActionScope,
  ctx: ToolContext,
  paneId?: string
): { sourceWorkspaceId: string; targetWorkspace: WorkspaceLike; crossWorkspace: boolean } {
  const sourceWorkspaceId = codeWorkspace(scope)
  const requestedWorkspaceId = str(args, 'workspaceId', 200)
  if (requestedWorkspaceId && requestedWorkspaceId !== sourceWorkspaceId) {
    const target = ctx.workspaceServ.get(requestedWorkspaceId) as WorkspaceLike | null
    if (!target) throw new ActionRefused('No workspace with that id exists. Use oxespace_list_workspaces.', 'not-found')
    // OXE-365: a pane the other workspace does not have is refused here, before any approval is shown for it.
    if (paneId && !target.panes?.some(pane => pane.id === paneId)) throw new ActionRefused('No pane with that id in that workspace.', 'not-found')
    return { sourceWorkspaceId, targetWorkspace: target, crossWorkspace: true }
  }
  const own = ctx.workspaceServ.get(sourceWorkspaceId) as WorkspaceLike | null
  if (!paneId) {
    if (!own) throw new ActionRefused('No workspace with that id exists.', 'not-found')
    return { sourceWorkspaceId, targetWorkspace: own, crossWorkspace: false }
  }
  if (own?.panes?.some(pane => pane.id === paneId)) {
    return { sourceWorkspaceId, targetWorkspace: own, crossWorkspace: false }
  }
  if (!requestedWorkspaceId) {
    const other = (ctx.workspaceServ.list() as WorkspaceLike[]).find(ws => ws.id !== sourceWorkspaceId && ws.panes?.some(pane => pane.id === paneId))
    if (other) return { sourceWorkspaceId, targetWorkspace: other, crossWorkspace: true }
  }
  throw new ActionRefused('No pane with that id in this workspace.', 'not-found')
}

/** Builds the approval request for a cross-workspace read, or returns null when reading the caller's own workspace. */
export function crossWorkspaceReadApproval(
  args: Args,
  scope: ActionScope,
  ctx: ToolContext,
  detail: { actionLabel: string; paneId?: string }
): Approval | null {
  const resolved = resolveReadableWorkspace(args, scope, ctx, detail.paneId)
  if (!resolved.crossWorkspace) return null
  const source = ctx.workspaceServ.get(resolved.sourceWorkspaceId) as WorkspaceLike | null
  const sourceName = source?.name?.trim() || scope.name || resolved.sourceWorkspaceId
  const targetName = resolved.targetWorkspace.name?.trim() || resolved.targetWorkspace.id
  // OXE-365: what the person reads names workspaces and panes, never their ids; the broker scope keeps the ids. A name
  // two workspaces share also shows the target's folder, so the person still knows which one they allow.
  const sameName = (ctx.workspaceServ.list() as WorkspaceLike[]).filter(ws => (ws.name?.trim() || ws.id) === targetName).length > 1
  const targetLabel = sameName ? `${targetName} (${resolved.targetWorkspace.rootPath || resolved.targetWorkspace.id})` : targetName
  const paneName = detail.paneId ? resolved.targetWorkspace.panes?.find(pane => pane.id === detail.paneId)?.displayName?.trim() : undefined
  const paneSuffix = detail.paneId ? (paneName ? ` (pane "${paneName}")` : ' (one pane)') : ''
  return {
    summary: `cross-workspace ${detail.actionLabel} in "${targetName}"`,
    target: targetLabel,
    text: `${detail.actionLabel} in workspace "${targetLabel}"${paneSuffix} from workspace "${sourceName}"`,
    notes: [mainMessage('approvals.note.workspace.crossRead', { source: sourceName, target: targetName })],
    brokerScope: crossWorkspaceReadScope(resolved.sourceWorkspaceId, resolved.targetWorkspace.id),
    brokerRisk: 'read',
    risk: 'low',
    sessionOptionLabel: mainMessage('approvals.option.allowSessionWorkspaceReads', {}),
    deniedMessage: `Cross-workspace read from "${sourceName}" (${resolved.sourceWorkspaceId}) to "${targetName}" (${resolved.targetWorkspace.id}) requires explicit user authorization, which was declined or unavailable.`
  }
}
