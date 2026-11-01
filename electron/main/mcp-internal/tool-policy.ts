import type { ToolContext } from './tool-registry'
import { policyBlockedMessage } from '../../../shared/policy'
import { policyStore } from '../services/policy'
import type { PolicyStore } from '../services/policy/policy-store'
import { resolve } from 'node:path'
import { CONFIGURABLE_MCP_TOOL_GROUPS, type ConfigurableMcpToolGroup } from '../../../shared/types/mcp-tools'
import { MCP_TOOL_GROUPS } from '../services/conversation/thread-mcp'
import { projectToolModes, type ProjectToolModes } from '../services/conversation/tool-groups'
import { loadRepoConfigSync, repoConfigStamp } from '../services/repo-config/loader'
import { recordIncident } from '../services/diagnostics/incident-sink'

/**
 * The policy resources an OXESpace tool answers to: the server key OxeChat gives it (`oxespace-delegation`) and the one
 * agents in OxeCode terminals see (`oxespace`), so a deny written either way holds.
 */
export const oxespaceToolResources = (tool: string): string[] => [`mcp__oxespace-delegation__${tool}`, `mcp__oxespace__${tool}`]

/**
 * The project folders whose policy a call answers to. The workspace header is the agent's own claim
 * (OXESPACE_WORKSPACE_ID), so it never chooses the policy by itself:
 * - a call that proves a live execution answers to that execution's folder and its workspace's or project's roots;
 * - any other call answers to every registered project, so the strictest deny among them holds.
 * Policy is checked against each root, and the user and managed layers apply to all of them.
 */
function callerRoots(ctx: Pick<ToolContext, 'db' | 'workspaceServ' | 'executions' | 'executionId' | 'executionToken' | 'workspaceId'>): string[] {
  const roots = new Set<string>()
  let execution: { cwd: string; workspaceId: string } | undefined
  try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) } catch { /* Not a live execution. */ }
  if (execution) {
    roots.add(execution.cwd)
    if (execution.workspaceId.startsWith('thread:')) {
      const rows = ctx.db?.prepare('SELECT root_path FROM thread_project_contexts WHERE project_id = ?').all(execution.workspaceId.slice('thread:'.length)) as { root_path: string }[] | undefined
      for (const row of rows ?? []) roots.add(row.root_path)
    } else {
      const workspace = ctx.workspaceServ.get(execution.workspaceId)
      if (workspace) roots.add(workspace.rootPath)
    }
    return [...roots]
  }
  for (const workspace of ctx.workspaceServ.list()) roots.add(workspace.rootPath)
  const rows = ctx.db?.prepare('SELECT DISTINCT root_path FROM thread_project_contexts').all() as { root_path: string }[] | undefined
  for (const row of rows ?? []) roots.add(row.root_path)
  return [...roots]
}

/**
 * A `tool.use` deny for an OXESpace tool holds at `tools/call` too, so it reaches agents in Code terminals and any
 * client that did not hide the tool. So does a tool group the project turned `off` in oxe.yaml (Settings › Tools):
 * the bridge's `--allowed-tools` only hides it, and the agent can edit those arguments, so main decides from the
 * caller's own roots. Returns the message the agent sees, or nothing when the call may run.
 */
export function toolCallBlocked(tool: string, ctx: Parameters<typeof callerRoots>[0], policy: PolicyStore | null = policyStore(),
  modesOf: (root: string) => ProjectToolModes = cachedToolModes): string | undefined {
  const roots = callerRoots(ctx)
  const off = offGroupBlocking(tool, roots, modesOf, callerRoleGroups(ctx))
  if (off) {
    recordIncident('incident.mcp.toolGroupOff', `${off}:${tool}`)
    // The C3 code is the incident's, the one Settings › Diagnostics shows for it.
    return `${tool} is not available: the "${off}" tools are turned off for this project (Settings › Tools). Code: incident.mcp.toolGroupOff`
  }
  if (!policy) return undefined
  for (const root of roots.length ? roots : [null]) {
    for (const resource of oxespaceToolResources(tool)) {
      const decision = policy.decide('tool.use', resource, root)
      if (!decision.allowed) return policyBlockedMessage(decision, tool)
    }
  }
  return undefined
}

/** Groups every caller has whatever the project says. The role groups (team, worker) count only for their holders. */
const UNCONDITIONAL_GROUPS = new Set(['core', 'code'])

/**
 * The role groups this caller really holds, from its authenticated execution: a conversation's Team membership or
 * delegation/Work role, a pane's Team link. A caller without an execution holds none.
 */
function callerRoleGroups(ctx: Parameters<typeof callerRoots>[0]): Set<string> {
  let execution: { owner?: { kind: 'pane' | 'thread'; id: string } } | undefined
  try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) } catch { return new Set() }
  const owner = execution?.owner
  if (!owner || !ctx.db) return new Set()
  const has = (sql: string): boolean => { try { return Boolean(ctx.db!.prepare(sql).get(owner.id)) } catch { return false } }
  const roles = new Set<string>()
  if (has(`SELECT 1 FROM agent_team_execution_links l JOIN agent_team_members m ON m.id=l.member_id
    WHERE l.owner_kind='${owner.kind}' AND l.owner_id=? AND m.archived=0 LIMIT 1`)) roles.add('team')
  if (owner.kind === 'thread' ? (has("SELECT 1 FROM delegations WHERE json_extract(payload, '$.destinationThreadId')=? LIMIT 1")
    || has('SELECT 1 FROM work_tasks WHERE thread_id=? LIMIT 1') || has('SELECT 1 FROM work_runs WHERE supervisor_thread_id=? LIMIT 1'))
    : has("SELECT 1 FROM delegations WHERE json_extract(payload, '$.paneId')=? LIMIT 1")) roles.add('worker')
  return roles
}

/**
 * The configurable group that keeps `tool` off for these roots, or nothing. A tool that also belongs to core or the
 * Code terminal's group, or to a role group the caller holds, is never blocked here; otherwise it is blocked when, in
 * any of the roots, every configurable group it belongs to is `off`: the strictest project wins, as with policy.
 */
export function offGroupBlocking(tool: string, roots: readonly string[], modesOf: (root: string) => ProjectToolModes,
  roleGroups: ReadonlySet<string> = new Set()): ConfigurableMcpToolGroup | undefined {
  const groups = Object.entries(MCP_TOOL_GROUPS).filter(([, tools]) => (tools as readonly string[]).includes(tool)).map(([group]) => group)
  if (!groups.length || groups.some(group => UNCONDITIONAL_GROUPS.has(group) || roleGroups.has(group))) return undefined
  const configurable = groups.filter((group): group is ConfigurableMcpToolGroup => (CONFIGURABLE_MCP_TOOL_GROUPS as readonly string[]).includes(group))
  for (const root of roots) {
    let modes: ProjectToolModes
    try { modes = modesOf(root) } catch { continue }
    if (configurable.length && configurable.every(group => modes[group].mode === 'off')) return configurable[0]
  }
  return undefined
}

/**
 * oxe.yaml's tool modes per root, read again only when the file's size or times change (hot path).
 * Fails closed: deleting the file, or making it unreadable, invalid or too large, is one command for the same agent,
 * so it never lifts an `off` read earlier in this run. The root keeps the last modes read from a valid file, and only a
 * root never read uses the defaults. B7.4 persists this and asks the person about any widening.
 */
const modesCache = new Map<string, { stamp: string; modes: ProjectToolModes }>()
/** One entry per folder however it is spelled (`C:\x`, `c:/x/`), so a second spelling has no fail-closed memory of its own. */
const rootKey = (root: string): string => { const full = resolve(root); return process.platform === 'win32' ? full.toLowerCase() : full }
function cachedToolModes(root: string): ProjectToolModes {
  const key = rootKey(root)
  const stamp = repoConfigStamp(root)
  const cached = modesCache.get(key)
  if (cached && cached.stamp === stamp) return cached.modes
  const config = stamp === 'missing' ? null : loadRepoConfigSync(root)
  // Missing, unreadable, invalid or too large: the last valid read stands (defaults if there never was one).
  let modes = config ? projectToolModes(config.thread) : cached?.modes ?? projectToolModes(undefined)
  // A valid rewrite that just drops a group's value (or misspells it, `offf`) does not lift an `off` read earlier; a
  // value the project states (`on-demand`, `always`) does, until B7.4 asks the person about such widenings.
  if (config && cached) {
    modes = Object.fromEntries(Object.entries(modes).map(([group, entry]) =>
      [group, entry.source === 'default' && cached.modes[group as ConfigurableMcpToolGroup].mode === 'off' ? cached.modes[group as ConfigurableMcpToolGroup] : entry])) as ProjectToolModes
  }
  modesCache.set(key, { stamp, modes })
  return modes
}
