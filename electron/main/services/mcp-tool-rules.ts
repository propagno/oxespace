/**
 * Settings › Tools, per tool (B7.3): whether each MCP tool a project can see runs without asking, asks, or never runs.
 *
 * `deny` is a `tool.use` rule in the project's `.oxespace/policy.json`, so it holds everywhere: OxeChat conversations
 * (launch exclusions and approvals), the internal MCP server's `tools/call`, and OxeCode terminals through it. `allow`
 * is a project permission rule, which answers OxeChat approvals; agents in OxeCode terminals keep following their own
 * CLI's permissions. `ask` is neither. The user and managed layers, and rules saved for all projects, are only read.
 */
import { join } from 'node:path'
import type { AppDatabase } from '../db'
import { evaluatePolicy, parsePolicy, type LoadedPolicy, type PolicyRule } from '../../../shared/policy'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import type { MessageCode, MessageParams } from '../../../shared/messages'
import type { McpToolDecision, McpToolRule } from '../../../shared/types/mcp-tools'
import type { ThreadPermissionRule } from '../../../shared/types/thread'
import type { FileSystemService } from './file-system.service'
import { ThreadPermissionStore } from './conversation/thread-permissions'
import { parseGuard } from './mcp-pin'
import { policyStore } from './policy'
import type { PolicyStore } from './policy/policy-store'

/** The key OXESpace's own tools have in a conversation, and in the policy resources that name them. */
export const OXESPACE_MCP_SERVER = 'oxespace-delegation'
const POLICY_FILE = '.oxespace/policy.json'
const SERVER_NAME = /^[A-Za-z0-9_.-]{1,100}$/
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,200}$/

export const toolResource = (server: string, tool: string): string => `mcp__${server}__${tool}`

/** What the window asked about, or which server lists tools. A live list is optional; the tools last seen are kept in the database. */
export interface ToolRulesDeps {
  db: AppDatabase
  files: FileSystemService
  policy?: PolicyStore | null
  servers?: { list(workspaceId: string | null): Array<{ name: string; workspaceId: string | null; tools: Array<{ name: string }> }> }
}

/** A refusal the window turns into words (C3): the message is the code. */
export class ToolRuleRefusal<Code extends MessageCode = MessageCode> extends Error {
  constructor(readonly code: Code, readonly params: MessageParams[Code]) { super(code) }
}

/** OXESpace tools with at least one action of the confirm level: they ask the person every time. */
export function confirmLevelTools(): Set<string> {
  const tools = new Set<string>()
  for (const capability of Object.values(MCP_COVERAGE)) {
    if (!('tools' in capability)) continue
    for (const [name, level] of Object.entries(capability.tools)) if (level === 'confirm') tools.add(name.split('#')[0])
  }
  return tools
}

/** The workspace id the file service accepts for a registered project root: a Code workspace or an OXESpace conversation project. */
function registeredProject(db: AppDatabase, rootPath: string): string | null {
  const workspace = db.prepare('SELECT id FROM workspaces WHERE root_path = ?').get(rootPath) as { id: string } | undefined
  if (workspace) return workspace.id
  const project = db.prepare('SELECT project_id FROM thread_project_contexts WHERE root_path = ?').get(rootPath) as { project_id: string } | undefined
  return project ? `thread:${project.project_id}` : null
}

/** The key a configured server gets in a conversation and in `.mcp.json`. */
const serverKey = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-server'
const isInternal = (server: { name: string; workspaceId: string | null }) => server.name === 'oxespace' && server.workspaceId === null

/** Tools of the servers configured for the project (global and its workspaces'), as last seen. */
function configuredTools(deps: ToolRulesDeps, rootPath: string): Array<[string, string]> {
  const workspaces = (deps.db.prepare('SELECT id FROM workspaces WHERE root_path = ?').all(rootPath) as { id: string }[]).map(row => row.id)
  const rows = deps.db.prepare(`SELECT name, workspace_id, guard_json FROM mcp_servers WHERE workspace_id IS NULL${workspaces.length ? ` OR workspace_id IN (${workspaces.map(() => '?').join(', ')})` : ''}`)
    .all(...workspaces) as { name: string; workspace_id: string | null; guard_json: string | null }[]
  const found: Array<[string, string]> = []
  for (const row of rows) {
    if (isInternal({ name: row.name, workspaceId: row.workspace_id })) continue
    for (const tool of parseGuard(row.guard_json)?.tools ?? []) found.push([serverKey(row.name), tool.name])
  }
  for (const workspaceId of workspaces.length ? workspaces : [null]) {
    for (const server of deps.servers?.list(workspaceId) ?? []) {
      if (!isInternal(server)) for (const tool of server.tools) found.push([serverKey(server.name), tool.name])
    }
  }
  return found
}

const exactMcp = (resource: string): [string, string] | null => {
  if (resource.includes('*')) return null
  const match = resource.match(/^mcp__(.+?)__(.+)$/)
  return match ? [match[1], match[2]] : null
}

const toolRuleMatches = (pattern: string, server: string, tool: string) => {
  const [ruleServer, ruleTool] = pattern.split('/')
  return ruleServer === server && (ruleTool === '*' || ruleTool === tool)
}

/** The deciding rule for one tool: policy first (it outranks permission rules), then the permission rules. */
function ruleFor(server: string, tool: string, loaded: LoadedPolicy, permissions: ThreadPermissionRule[]): McpToolRule {
  const verdict = evaluatePolicy(loaded, 'tool.use', toolResource(server, tool))
  if (!verdict.allowed) {
    const source = verdict.layer ?? 'project'
    // A wildcard is the file's to change, not one tool's row.
    return { server, tool, decision: 'deny', source, editable: source === 'project' && !verdict.rule?.resource.includes('*'), scope: 'everywhere' }
  }
  const matching = permissions.filter(rule => rule.kind === 'tool' && toolRuleMatches(rule.pattern, server, tool))
  const deciding = matching.find(rule => rule.decision === 'deny') ?? matching.find(rule => rule.decision === 'allow')
  if (deciding) {
    const project = deciding.projectRoot !== null
    // A rule saved for all projects is the person's own, like the user policy: shown, never changed from a project.
    return { server, tool, decision: deciding.decision, source: project ? 'project' : 'user', editable: project && deciding.pattern === `${server}/${tool}`, scope: 'oxechat' }
  }
  return { server, tool, decision: 'ask', source: 'default', editable: true, scope: null }
}

function requireProject(db: AppDatabase, rootPath: string): string {
  const workspaceId = registeredProject(db, rootPath)
  if (!workspaceId) throw new Error('This folder is not a project OXESpace knows')
  return workspaceId
}

const policyOf = (deps: ToolRulesDeps): PolicyStore => {
  const policy = deps.policy === undefined ? policyStore() : deps.policy
  if (!policy) throw new Error('Policy is not available')
  return policy
}

/** Every MCP tool the project can see, with its rule: OXESpace's first, then each server's, then tools only a rule names. */
export async function toolRules(deps: ToolRulesDeps, rootPath: string): Promise<McpToolRule[]> {
  requireProject(deps.db, rootPath)
  const { TOOL_REGISTRY } = await import('../mcp-internal/tool-registry')
  const loaded = policyOf(deps).load(rootPath)
  const permissions = new ThreadPermissionStore(deps.db).rules(rootPath)
  const seen = new Set<string>()
  const pairs: Array<[string, string]> = []
  const add = ([server, tool]: [string, string]) => {
    const key = `${server}\0${tool}`
    if (!SERVER_NAME.test(server) || !TOOL_NAME.test(tool) || seen.has(key)) return
    seen.add(key); pairs.push([server, tool])
  }
  for (const entry of TOOL_REGISTRY) add([OXESPACE_MCP_SERVER, entry.descriptor.name])
  const others: Array<[string, string]> = [...configuredTools(deps, rootPath)]
  for (const source of loaded.sources) for (const rule of source.rules) {
    const named = rule.action === 'tool.use' ? exactMcp(rule.resource) : null
    if (named) others.push(named)
  }
  for (const rule of permissions) if (rule.kind === 'tool' && !rule.pattern.endsWith('/*')) others.push(rule.pattern.split('/') as [string, string])
  others.sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y)).forEach(add)
  return pairs.map(([server, tool]) => ruleFor(server, tool, loaded, permissions))
}

/**
 * Sets one tool's rule in the project, at the person's request from the app's window, and records each change in the
 * project's audit. Refuses, writing nothing: a folder OXESpace does not know, a project policy file that is not valid,
 * a tool whose rule comes from the user or managed layer, and `allow` for an OXESpace tool of the confirm level.
 */
export async function setToolRule(deps: ToolRulesDeps, input: { rootPath: string; server: string; tool: string; decision: McpToolDecision }): Promise<McpToolRule[]> {
  const { rootPath, server, tool, decision } = input
  if (!SERVER_NAME.test(server) || server.includes('__') || !TOOL_NAME.test(tool)) throw new Error('Invalid MCP tool')
  const workspaceId = requireProject(deps.db, rootPath)
  const policy = policyOf(deps)
  const target = { workspaceId, rootPath, relativePath: POLICY_FILE }
  const path = join(rootPath, '.oxespace', 'policy.json')
  const existing = await deps.files.readFile(target).then(file => file.content, (error: NodeJS.ErrnoException) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  let document: { rules: unknown[] } & Record<string, unknown> = { rules: [] }
  if (existing !== null) {
    if ('problem' in parsePolicy(existing, 'project', path)) throw new ToolRuleRefusal('mcp.toolRule.invalidPolicy', {})
    document = JSON.parse(existing) as typeof document
  }
  policy.forget(path)
  const store = new ThreadPermissionStore(deps.db)
  const current = ruleFor(server, tool, policy.load(rootPath), store.rules(rootPath))
  const name = `${server}/${tool}`
  if (!current.editable) throw new ToolRuleRefusal('mcp.toolRule.locked', { tool: name })
  if (decision === 'allow' && server === OXESPACE_MCP_SERVER && confirmLevelTools().has(tool)) throw new ToolRuleRefusal('mcp.toolRule.confirmLevel', { tool: name })

  // The project's policy: only this tool's exact `tool.use` rules change; everything else is kept as it was.
  const resource = toolResource(server, tool).toLowerCase()
  const isThisTool = (rule: unknown) => {
    const value = rule as Partial<PolicyRule>
    return value?.action === 'tool.use' && typeof value.resource === 'string' && value.resource.trim().toLowerCase() === resource
  }
  const rules = [...document.rules.filter(rule => !isThisTool(rule)), ...(decision === 'deny' ? [{ effect: 'deny', action: 'tool.use', resource: toolResource(server, tool) }] : [])]
  if (JSON.stringify(rules) !== JSON.stringify(document.rules) && (existing !== null || rules.length)) {
    const eol = existing?.includes('\r\n') ? '\r\n' : '\n'
    const content = JSON.stringify({ ...document, rules }, null, 2).replace(/\n/g, eol) + eol
    if ('problem' in parsePolicy(content, 'project', path)) throw new ToolRuleRefusal('mcp.toolRule.invalidPolicy', {})
    if (existing === null) {
      await deps.files.createDirectory({ workspaceId, rootPath, relativePath: '.oxespace' })
      await deps.files.createFile({ ...target, content })
    } else {
      await deps.files.writeFile({ ...target, content })
    }
    policy.forget(path)
    store.audit({ projectRoot: rootPath, action: 'configuration', actor: 'user',
      summary: decision === 'deny' ? `Blocked the MCP tool ${name} in ${POLICY_FILE}` : `Removed the block on the MCP tool ${name} from ${POLICY_FILE}` })
  }

  // The project's permission rules for exactly this tool: only an `allow` stays, and only when it was asked for.
  const own = store.rules(rootPath).filter(rule => rule.projectRoot === rootPath && rule.kind === 'tool' && rule.pattern === name)
  for (const rule of own) {
    if (decision === 'allow' && rule.decision === 'allow') continue
    store.remove(rule.id)
    store.audit({ projectRoot: rootPath, action: 'rule-removed', actor: 'user', summary: `Removed ${rule.decision} tool ${name}` })
  }
  if (decision === 'allow' && !own.some(rule => rule.decision === 'allow')) {
    store.add({ projectRoot: rootPath, kind: 'tool', pattern: name, decision: 'allow' })
    store.audit({ projectRoot: rootPath, action: 'rule-added', actor: 'user', summary: `Allow tool ${name}` })
  }
  return toolRules(deps, rootPath)
}
