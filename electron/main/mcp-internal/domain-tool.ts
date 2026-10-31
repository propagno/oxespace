import { basename } from 'node:path'
import type { ToolContext, ToolEntry } from './tool-registry'
import { ActionRefused, AgentActions, type ActionActor } from '../services/agent-actions/agent-actions'
import type { ActionLevel } from '../services/agent-actions/action-audit'
import type { AppServices } from './app-services'
import type { InternalMcpToolDescriptor } from '../../../shared/types/mcp-internal'

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

export interface Approval { summary: string; text: string; reasons?: string[] }

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
   */
  confirm?: (args: Args, scope: ActionScope, ctx: ToolContext) => Promise<Approval | null> | Approval | null
  /** Replaces "A person approves each call." in the tool description. */
  approvalNote?: string
  /** Kept for callers with this role: the tool lists and runs it only for them, and to anyone else it does not exist. */
  role?: ActionRole
  run: (args: Args, scope: ActionScope, ctx: ToolContext) => Promise<unknown>
}

export type ActionRole = import('../services/conversation/thread-coordinator').ThreadActionRole
type RoleContext = Pick<ToolContext, 'db' | 'executions' | 'executionId' | 'executionToken' | 'workspaceId'>

/** The caller's roles for role-kept actions: none unless it is a live Thread execution that has them. */
export async function callerRoles(ctx: RoleContext): Promise<ReadonlySet<ActionRole>> {
  let owner: ActionScope['owner']
  try { owner = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId).owner } catch { /* not a live execution */ }
  if (owner?.kind !== 'thread' || !ctx.db) return new Set()
  return (await import('../services/conversation/thread-coordinator')).threadActionRoles(ctx.db, owner.id)
}

/** Without a policy service (tests, or a build that did not wire one), writes still need an execution. */
const fallbackActions = new AgentActions()

/**
 * Resolves the caller. A live execution (a Code pane or a Thread started by
 * OXESpace) is authoritative; a caller without one may only read, scoped to the
 * workspace it names or the active one.
 */
export async function resolveScope(ctx: ToolContext): Promise<ActionScope> {
  let execution: ReturnType<NonNullable<ToolContext['executions']>['authenticate']> | undefined
  try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) } catch { /* not a live execution */ }
  if (execution) {
    const workspace = execution.workspaceId.startsWith('thread:') ? null : ctx.workspaceServ.get(execution.workspaceId)
    return {
      rootPath: execution.canonicalRoot, name: workspace?.name ?? basename(execution.canonicalRoot), workspaceId: execution.workspaceId, owner: execution.owner,
      actor: { key: execution.id, label: `${execution.owner.kind}:${execution.owner.id}`, workspaceId: execution.workspaceId, authenticated: true }
    }
  }
  const named = ctx.workspaceId && !ctx.workspaceId.startsWith('thread:') ? ctx.workspaceServ.get(ctx.workspaceId) : null
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
  const describe = (keys: string[]): InternalMcpToolDescriptor => {
    const properties: Record<string, unknown> = { action: { type: 'string', enum: keys, description: 'What to do. See the tool description for each action.' } }
    for (const key of keys) Object.assign(properties, actions[key].properties ?? {})
    const lines = keys.map(key => {
      const action = actions[key]
      const needs = action.level === 'confirm' ? ` ${action.approvalNote ?? 'A person approves each call.'}` : ''
      const required = action.required?.length ? ` Requires: ${action.required.join(', ')}.` : ''
      return `- ${key} (${action.level}): ${action.description}${required}${needs}`
    })
    return { name, description: `${summary}\n${lines.join('\n')}`, inputSchema: { type: 'object', properties, required: ['action'], additionalProperties: false } }
  }
  const offeredKeys = (roles: ReadonlySet<ActionRole>) => Object.keys(actions).filter(key => !actions[key].role || roles.has(actions[key].role!))
  const kept = Object.values(actions).some(action => action.role)
  return {
    // The registry's descriptor names every action, for the coverage manifest; a caller is listed only what it is offered.
    descriptor: describe(Object.keys(actions)),
    ...(kept ? { offered: (roles: ReadonlySet<ActionRole>) => describe(offeredKeys(roles)) } : {}),
    requiresWorkspace: false,
    handler: async (raw, ctx) => {
      const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Args
      const key = typeof args.action === 'string' ? args.action : ''
      const listed = Object.hasOwn(actions, key) ? actions[key] : undefined
      // A role-kept action is refused like an unknown one, so a caller without the role does not learn it exists.
      const offered = kept && (!listed || listed.role) ? offeredKeys(await callerRoles(ctx)) : Object.keys(actions)
      const action = listed && offered.includes(key) ? listed : undefined
      if (!action) return reply({ schemaVersion: 1, ok: false, code: 'invalid', message: `action must be one of: ${offered.join(', ')}` }, true)
      try {
        const missing = (action.required ?? []).filter(field => args[field] === undefined || args[field] === null || args[field] === '')
        if (missing.length) throw new ActionRefused(`${key} requires: ${missing.join(', ')}.`, 'invalid')
        const scope = await resolveScope(ctx)
        const approval = action.level === 'confirm' && action.confirm ? await action.confirm(args, scope, ctx) : undefined
        const level = action.level === 'confirm' && approval === null ? 'write' : action.level
        const result = await (ctx.agentActions ?? fallbackActions).run(scope.actor, {
          tool: name, action: key, level, target: scope.rootPath, summary: approval?.summary, text: approval?.text, reasons: approval?.reasons
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
