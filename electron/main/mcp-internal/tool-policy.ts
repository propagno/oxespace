import type { ToolContext } from './tool-registry'
import { evaluatePolicy, policyBlockedMessage, type LoadedPolicy } from '../../../shared/policy'
import { policyStore } from '../services/policy'
import type { PolicyStore } from '../services/policy/policy-store'
import { CONFIGURABLE_MCP_TOOL_GROUPS, type ConfigurableMcpToolGroup } from '../../../shared/types/mcp-tools'
import { MCP_TOOL_GROUPS } from '../services/conversation/thread-mcp'
import type { ProjectToolModes } from '../services/conversation/tool-groups'
import { enforcedToolModes } from '../services/policy/tool-config'
import { recordIncident } from '../services/diagnostics/incident-sink'

/**
 * The policy resources an OXESpace tool answers to: the server key OxeChat gives it (`oxespace-delegation`) and the one
 * agents in OxeCode terminals see (`oxespace`), so a deny written either way holds.
 */
export const oxespaceToolResources = (tool: string): string[] => [`mcp__oxespace-delegation__${tool}`, `mcp__oxespace__${tool}`]

type CallerContext = Pick<ToolContext, 'db' | 'workspaceServ' | 'executions' | 'executionId' | 'executionToken' | 'workspaceId'>
type AuthenticatedCaller = { cwd: string; workspaceId: string; owner?: { kind: 'pane' | 'thread'; id: string } }

function authenticateCaller(ctx: CallerContext): AuthenticatedCaller | undefined {
  try {
    return ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId)
  } catch {
    return undefined
  }
}

/**
 * The project folders whose policy a call answers to. The workspace header is the agent's own claim
 * (OXESPACE_WORKSPACE_ID), so it never chooses the policy by itself:
 * - a call that proves a live execution answers to that execution's folder and its workspace's or project's roots;
 * - any other call answers to every registered project, so the strictest deny among them holds.
 * Policy is checked against each root, and the user and managed layers apply to all of them.
 */
function callerRoots(ctx: CallerContext, execution: AuthenticatedCaller | undefined = authenticateCaller(ctx)): { roots: string[]; sweep: boolean } {
  const roots = new Set<string>()
  if (execution) {
    roots.add(execution.cwd)
    if (execution.workspaceId.startsWith('thread:')) {
      const rows = ctx.db?.prepare('SELECT root_path FROM thread_project_contexts WHERE project_id = ?').all(execution.workspaceId.slice('thread:'.length)) as { root_path: string }[] | undefined
      for (const row of rows ?? []) roots.add(row.root_path)
    } else {
      const workspace = ctx.workspaceServ.get(execution.workspaceId)
      if (workspace) roots.add(workspace.rootPath)
    }
    return { roots: [...roots], sweep: false }
  }
  for (const workspace of ctx.workspaceServ.list()) roots.add(workspace.rootPath)
  const rows = ctx.db?.prepare('SELECT DISTINCT root_path FROM thread_project_contexts').all() as { root_path: string }[] | undefined
  for (const row of rows ?? []) roots.add(row.root_path)
  return { roots: [...roots], sweep: true }
}

/**
 * Builds a reusable per-request blocker that resolves caller roots, role groups, per-root tool modes and policy
 * snapshots ONCE and reuses them across all tools in a batch scan (e.g. `oxespace_tools_search`), preserving
 * identical security/policy decisions to `toolCallBlocked`.
 */
export function createToolCallBlocker(
  ctx: CallerContext,
  policy: PolicyStore | null = policyStore(),
  modesOf?: (root: string) => ProjectToolModes,
  options: { recordIncidents?: boolean } = {}
): (tool: string) => string | undefined {
  const execution = authenticateCaller(ctx)
  const { roots, sweep } = callerRoots(ctx, execution)
  const roleGroups = callerRoleGroups(ctx, execution)
  const recordIncidents = options.recordIncidents !== false
  const modeReader = modesOf ?? (root => enforcedToolModes(root, { defer: sweep }).modes)
  const modesCache = new Map<string, { ok: true; modes: ProjectToolModes } | { ok: false }>()

  const readRootModes = (root: string): { ok: true; modes: ProjectToolModes } | { ok: false } => {
    const cached = modesCache.get(root)
    if (cached) return cached
    let result: { ok: true; modes: ProjectToolModes } | { ok: false }
    try {
      result = { ok: true, modes: modeReader(root) }
    } catch {
      // Fails closed: a root whose modes cannot be read (the gate's database busy, full or closed) counts as every group off.
      result = { ok: false }
    }
    modesCache.set(root, result)
    return result
  }

  const policyRoots: Array<string | null> = roots.length ? roots : [null]
  let loadedPolicies: LoadedPolicy[] | null = null
  let hasToolUseRules = false
  const loadPoliciesOnce = (): LoadedPolicy[] => {
    if (loadedPolicies !== null) return loadedPolicies
    if (!policy || typeof policy.load !== 'function') {
      loadedPolicies = []
      return loadedPolicies
    }
    // The sweep of every registered root (a call outside a live execution) parks what it finds (B7.4): the floor
    // applies at once, and each project is asked at its own launch or Settings read.
    loadedPolicies = policyRoots.map(root => policy.load(root, { defer: sweep }))
    hasToolUseRules = loadedPolicies.some(loaded =>
      loaded.sources.some(source => source.rules.some(rule => rule.action === 'tool.use'))
    )
    return loadedPolicies
  }

  return (tool: string): string | undefined => {
    const off = offGroupBlockingWithCache(tool, roots, readRootModes, roleGroups)
    if (off) {
      if (recordIncidents) recordIncident('incident.mcp.toolGroupOff', `${off}:${tool}`)
      // The C3 code is the incident's, the one Settings › Diagnostics shows for it.
      return `${tool} is not available: the "${off}" tools are turned off for this project (Settings › Tools). Ask the person to turn it on; editing the MCP configuration does not change this. Code: incident.mcp.toolGroupOff`
    }
    if (!policy) return undefined
    if (typeof policy.load === 'function') {
      const policies = loadPoliciesOnce()
      if (!hasToolUseRules) return undefined
      for (const loaded of policies) {
        for (const resource of oxespaceToolResources(tool)) {
          const decision = evaluatePolicy(loaded, 'tool.use', resource)
          if (!decision.allowed) return policyBlockedMessage(decision, tool)
        }
      }
      return undefined
    }
    for (const root of policyRoots) {
      for (const resource of oxespaceToolResources(tool)) {
        const decision = policy.decide('tool.use', resource, root, { defer: sweep })
        if (!decision.allowed) return policyBlockedMessage(decision, tool)
      }
    }
    return undefined
  }
}

/**
 * A `tool.use` deny for an OXESpace tool holds at `tools/call` too, so it reaches agents in Code terminals and any
 * client that did not hide the tool. So does a tool group the project turned `off` in oxe.yaml (Settings › Tools):
 * the bridge's `--allowed-tools` only hides it, and the agent can edit those arguments, so main decides from the
 * caller's own roots. Returns the message the agent sees, or nothing when the call may run.
 */
export function toolCallBlocked(tool: string, ctx: CallerContext, policy: PolicyStore | null = policyStore(),
  modesOf?: (root: string) => ProjectToolModes): string | undefined {
  return createToolCallBlocker(ctx, policy, modesOf)(tool)
}

/** Groups every caller has whatever the project says. The role groups (team, worker) count only for their holders. */
const UNCONDITIONAL_GROUPS = new Set(['core', 'code'])

interface ToolGroupMeta {
  groups: string[]
  configurable: ConfigurableMcpToolGroup[]
  unconditional: boolean
}

const TOOL_GROUP_INFO: ReadonlyMap<string, ToolGroupMeta> = (() => {
  const byTool = new Map<string, string[]>()
  for (const [group, tools] of Object.entries(MCP_TOOL_GROUPS)) {
    for (const tool of tools as readonly string[]) {
      const list = byTool.get(tool)
      if (list) list.push(group)
      else byTool.set(tool, [group])
    }
  }
  const configurableSet = new Set<string>(CONFIGURABLE_MCP_TOOL_GROUPS)
  const out = new Map<string, ToolGroupMeta>()
  for (const [tool, groups] of byTool) {
    out.set(tool, {
      groups,
      configurable: groups.filter((group): group is ConfigurableMcpToolGroup => configurableSet.has(group)),
      unconditional: groups.some(group => UNCONDITIONAL_GROUPS.has(group))
    })
  }
  return out
})()

/**
 * The role groups this caller really holds, from its authenticated execution: a conversation's Team membership or
 * delegation/Work role, a pane's Team link. A caller without an execution holds none.
 */
function callerRoleGroups(ctx: CallerContext, execution: AuthenticatedCaller | undefined = authenticateCaller(ctx)): Set<string> {
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

function offGroupBlockingWithCache(
  tool: string,
  roots: readonly string[],
  readRootModes: (root: string) => { ok: true; modes: ProjectToolModes } | { ok: false },
  roleGroups: ReadonlySet<string>
): ConfigurableMcpToolGroup | undefined {
  const info = TOOL_GROUP_INFO.get(tool)
  if (!info || info.unconditional || info.groups.some(group => roleGroups.has(group))) return undefined
  if (!info.configurable.length) return undefined
  for (const root of roots) {
    const result = readRootModes(root)
    if (!result.ok) return info.configurable[0]
    if (info.configurable.every(group => result.modes[group].mode === 'off')) return info.configurable[0]
  }
  return undefined
}

/**
 * The configurable group that keeps `tool` off for these roots, or nothing. A tool that also belongs to core or the
 * Code terminal's group, or to a role group the caller holds, is never blocked here; otherwise it is blocked when, in
 * any of the roots, every configurable group it belongs to is `off`: the strictest project wins, as with policy.
 */
export function offGroupBlocking(tool: string, roots: readonly string[], modesOf: (root: string) => ProjectToolModes,
  roleGroups: ReadonlySet<string> = new Set()): ConfigurableMcpToolGroup | undefined {
  return offGroupBlockingWithCache(tool, roots, root => {
    try { return { ok: true, modes: modesOf(root) } } catch { return { ok: false } }
  }, roleGroups)
}

