import type { ToolContext } from './tool-registry'
import { policyBlockedMessage } from '../../../shared/policy'
import { policyStore } from '../services/policy'
import type { PolicyStore } from '../services/policy/policy-store'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIGURABLE_MCP_TOOL_GROUPS, type ConfigurableMcpToolGroup } from '../../../shared/types/mcp-tools'
import { MCP_TOOL_GROUPS } from '../services/conversation/thread-mcp'
import { projectToolModes, type ProjectToolModes } from '../services/conversation/tool-groups'
import { loadRepoConfigSync } from '../services/repo-config/loader'
import { OXE_YAML_FILE } from '../services/repo-config/parser'
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
  const off = offGroupBlocking(tool, roots, modesOf)
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

/** Groups every caller has whatever the project says: core, and the role groups OXESpace grants itself. */
const ALWAYS_GROUPS = new Set(Object.keys(MCP_TOOL_GROUPS).filter(group => !(CONFIGURABLE_MCP_TOOL_GROUPS as readonly string[]).includes(group)))

/**
 * The configurable group that keeps `tool` off for these roots, or nothing. A tool that also belongs to an always-on
 * group (core, the Code terminal's, team, worker, coordinator) is never blocked here; otherwise it is blocked when, in
 * any of the roots, every configurable group it belongs to is `off`: the strictest project wins, as with policy.
 */
export function offGroupBlocking(tool: string, roots: readonly string[], modesOf: (root: string) => ProjectToolModes): ConfigurableMcpToolGroup | undefined {
  const groups = Object.entries(MCP_TOOL_GROUPS).filter(([, tools]) => (tools as readonly string[]).includes(tool)).map(([group]) => group)
  if (!groups.length || groups.some(group => ALWAYS_GROUPS.has(group))) return undefined
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
function cachedToolModes(root: string): ProjectToolModes {
  let stamp = 'missing'
  try { const stat = statSync(join(root, OXE_YAML_FILE)); stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` } catch { /* no oxe.yaml */ }
  const cached = modesCache.get(root)
  if (cached && cached.stamp === stamp) return cached.modes
  const config = stamp === 'missing' ? null : loadRepoConfigSync(root)
  // Missing, unreadable, invalid or too large: the last valid read stands (defaults if there never was one).
  const modes = config ? projectToolModes(config.thread) : cached?.modes ?? projectToolModes(undefined)
  modesCache.set(root, { stamp, modes })
  return modes
}
