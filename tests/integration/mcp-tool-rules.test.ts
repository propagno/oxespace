import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { FileSystemService } from '../../electron/main/services/file-system.service'
import { ThreadPermissionStore } from '../../electron/main/services/conversation/thread-permissions'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { readManagedMcp } from '../../electron/main/services/conversation/thread-managed-mcp'
import { McpConfigSync } from '../../electron/main/services/mcp-sync.service'
import { threadMcpArguments } from '../../electron/main/services/conversation/thread-mcp'
import { confirmLevelTools, setToolRule, toolRules, type ToolRulesDeps } from '../../electron/main/services/mcp-tool-rules'
import { policyDeniedToolNames, setPolicyStore } from '../../electron/main/services/policy'
import { PolicyStore } from '../../electron/main/services/policy/policy-store'
import { toolCallBlocked } from '../../electron/main/mcp-internal/tool-policy'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { McpManager } from '../../electron/main/services/mcp.service'
import type { AgentConversationAdapter, ThreadEvent, ThreadRequest, ThreadRequestResponse } from '../../shared/types/thread'
import { serverKey } from '../../shared/types/mcp'
import { isMcpToolRuleRefusal, MCP_TOOL_RULE_REFUSAL_CODES, type McpToolRule } from '../../shared/types/mcp-tools'
import { removeTempDir } from '../helpers/removeTempDir'

vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

const roots: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  setPolicyStore(null)
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) removeTempDir(root)
})

const temp = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); roots.push(dir); return dir }

/** A Code workspace 'A' at the root, or a project that exists only in OxeChat conversations (`thread:p`). */
function project(kind: 'workspace' | 'conversation' = 'workspace') {
  const root = temp('oxe-tool-rules-')
  const userData = temp('oxe-tool-rules-user-')
  const db = openInMemoryDatabase(); databases.push(db)
  if (kind === 'workspace') {
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  } else {
    db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('p', 'p', ?, 'P', 0, 0)").run(root)
    db.prepare("INSERT INTO thread_project_contexts (project_id, root_path) VALUES ('p', ?)").run(root)
  }
  // The app's resolver (file-system.ipc.ts): a workspace by id, or a conversation project's registered root.
  const files = new FileSystemService((workspaceId, requested) => {
    if (workspaceId.startsWith('thread:')) {
      const row = db.prepare('SELECT root_path FROM thread_project_contexts WHERE project_id = ? AND root_path = ?').get(workspaceId.slice('thread:'.length), requested) as { root_path: string } | undefined
      return row?.root_path ?? null
    }
    const row = db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(workspaceId) as { root_path: string } | undefined
    return row && row.root_path === requested ? row.root_path : null
  })
  const policy = new PolicyStore({ userData, managed: join(userData, 'managed.json') })
  setPolicyStore(policy)
  const deps: ToolRulesDeps = { db, files, policy }
  const policyFile = join(root, '.oxespace', 'policy.json')
  const readPolicy = () => JSON.parse(readFileSync(policyFile, 'utf8')) as { rules: unknown[] } & Record<string, unknown>
  const projectRules = () => new ThreadPermissionStore(db).rules(root).filter(rule => rule.projectRoot === root).map(rule => [rule.kind, rule.pattern, rule.decision])
  const audit = () => new ThreadPermissionStore(db).auditLog({ projectRoot: root }).map(entry => [entry.action, entry.summary]).reverse()
  return { root, userData, db, files, policy, deps, policyFile, readPolicy, projectRules, audit }
}

const find = (rules: McpToolRule[], server: string, tool: string) => rules.find(rule => rule.server === server && rule.tool === tool)

describe('Per-tool rules (B7.3)', () => {
  it('lists OXESpace tools and configured servers\' tools, asking by default', async () => {
    const { root, db, deps } = project()
    db.prepare('INSERT INTO mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, created_at, updated_at, guard_json) VALUES (?, ?, ?, ?, ?, 1, 1, 0, 0, ?)')
      .run('g', null, 'GitHub', 'stdio', '{"transport":"stdio","command":"gh"}', JSON.stringify({ pin: { hash: 'x', at: 0 }, tools: [{ name: 'create_issue', hash: 'h' }], quarantine: null }))
    const rules = await toolRules(deps, root)
    expect(find(rules, 'oxespace-delegation', 'oxespace_project_context')).toEqual({ server: 'oxespace-delegation', tool: 'oxespace_project_context', decision: 'ask', source: 'default', editable: true, allowedDecisions: ['allow', 'ask', 'deny'], confirmLevel: false, scope: null })
    expect(find(rules, 'github', 'create_issue')).toMatchObject({ decision: 'ask', source: 'default' })
    expect(rules[0].server).toBe('oxespace-delegation')
  })

  it('deny creates policy.json, blocks the tool at launch, in approvals and at tools/call, and is audited', async () => {
    const { root, deps, policyFile, readPolicy, audit, db } = project()
    expect(existsSync(join(root, '.oxespace'))).toBe(false)
    const rules = await setToolRule(deps, { rootPath: root, server: 'oxespace-delegation', tool: 'oxespace_list_workspaces', decision: 'deny' })
    expect(readFileSync(policyFile, 'utf8')).toBe('{\n  "rules": [\n    {\n      "effect": "deny",\n      "action": "tool.use",\n      "resource": "mcp__oxespace-delegation__oxespace_list_workspaces"\n    }\n  ]\n}\n')
    expect(readPolicy().rules).toHaveLength(1)
    expect(find(rules, 'oxespace-delegation', 'oxespace_list_workspaces')).toEqual({ server: 'oxespace-delegation', tool: 'oxespace_list_workspaces', decision: 'deny', source: 'project', editable: true, allowedDecisions: ['allow', 'ask', 'deny'], confirmLevel: false, scope: 'everywhere' })
    expect(audit()).toEqual([['configuration', 'Blocked the MCP tool oxespace-delegation/oxespace_list_workspaces in .oxespace/policy.json']])

    // OxeChat: hidden from Claude and Codex at launch.
    const denied = policyDeniedToolNames(root)
    expect(threadMcpArguments('claude', [], '/bridge.cjs', undefined, [], undefined, denied).join(' ')).toContain('--disallowedTools mcp__oxespace-delegation__oxespace_list_workspaces')
    expect(threadMcpArguments('codex', [], '/bridge.cjs', undefined, [], undefined, denied)).toContain('mcp_servers.oxespace-delegation.disabled_tools=["oxespace_list_workspaces"]')

    // The internal MCP server's check (tool-policy, covered by policy-tool-use-enforcement) reads the rule written here.
    const ctx = { db, workspaceServ: new WorkspaceService(db) }
    expect(toolCallBlocked('oxespace_list_workspaces', ctx, deps.policy)).toContain('blocked by this project’s policy')
    expect(toolCallBlocked('oxespace_execution_context', ctx, deps.policy)).toBeUndefined()
  })

  it('deny keeps the other rules and fields of an existing policy.json', async () => {
    const { root, deps, policyFile, readPolicy } = project()
    mkdirSync(join(root, '.oxespace'))
    writeFileSync(policyFile, JSON.stringify({ organization: 'Acme', rules: [{ effect: 'deny', action: 'provider.use', resource: 'codex' }] }))
    await setToolRule(deps, { rootPath: root, server: 'github', tool: 'delete_repository', decision: 'deny' })
    expect(readPolicy()).toEqual({ organization: 'Acme', rules: [
      { effect: 'deny', action: 'provider.use', resource: 'codex' },
      { effect: 'deny', action: 'tool.use', resource: 'mcp__github__delete_repository' }
    ] })
    expect(readFileSync(policyFile, 'utf8')).toMatch(/^\{\n {2}"organization": "Acme",\n/)
  })

  it('allow adds a project permission rule that auto-approves the tool in an OxeChat conversation', { timeout: 30_000 }, async () => {
    const { root, db, deps, projectRules, audit } = project()
    const rules = await setToolRule(deps, { rootPath: root, server: 'github', tool: 'create_issue', decision: 'allow' })
    expect(find(rules, 'github', 'create_issue')).toEqual({ server: 'github', tool: 'create_issue', decision: 'allow', source: 'project', editable: true, allowedDecisions: ['allow', 'ask', 'deny'], confirmLevel: false, scope: 'oxechat' })
    expect(projectRules()).toEqual([['tool', 'github/create_issue', 'allow']])
    expect(audit()).toEqual([['rule-added', 'Allow tool github/create_issue']])

    let emit: (event: ThreadEvent) => void = () => {}
    const responses: { id: string; response: ThreadRequestResponse }[] = []
    const factory = vi.fn(async () => ({
      capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, listener) => { emit = listener; listener({ type: 'session', nativeSessionId: 'n' }) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}), configure: vi.fn(async () => {}),
      respondRequest: vi.fn(async (id: string, response: ThreadRequestResponse) => {
        responses.push({ id, response })
        emit({ type: 'request-resolved', id, state: 'resolved', resolution: response.decision === 'accept' ? 'approved' : 'declined', resolvedAt: Date.now() })
      })
    }) as AgentConversationAdapter)
    const manager = new ThreadManager(db, factory, vi.fn())
    vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
    const id = manager.create({ workspaceId: 'A', projectId: 'p', rootPath: root, provider: 'claude' }).thread.id
    await manager.send(id, 'Go')
    const request = (requestId: string, toolName: string) => emit({ type: 'request', id: requestId, request: {
      id: requestId, nativeId: requestId, nativeMethod: `can_use_tool:${toolName}`, kind: 'approval', title: `Approve ${toolName}`, generation: 0, createdAt: Date.now(), state: 'pending', availableDecisions: ['accept', 'decline'], toolName
    } as ThreadRequest })
    await setToolRule(deps, { rootPath: root, server: 'github', tool: 'delete_repository', decision: 'deny' })
    request('r1', 'mcp__github__create_issue'); await settle()
    request('r2', 'mcp__github__delete_repository'); await settle()
    request('r3', 'mcp__github__list_issues'); await settle()
    expect(responses).toEqual([
      { id: 'r1', response: { decision: 'accept' } },
      { id: 'r2', response: { decision: 'decline', reason: expect.stringContaining('blocked by this project’s policy') } }
    ])
    await manager.stop()
  })

  it('ask removes both, and deny → allow → ask leaves nothing behind', async () => {
    const { root, deps, readPolicy, projectRules, audit } = project()
    const target = { rootPath: root, server: 'github', tool: 'create_issue' }
    await setToolRule(deps, { ...target, decision: 'deny' })
    await setToolRule(deps, { ...target, decision: 'allow' })
    expect(readPolicy().rules).toEqual([])
    expect(projectRules()).toEqual([['tool', 'github/create_issue', 'allow']])
    await setToolRule(deps, { ...target, decision: 'deny' })
    expect(projectRules()).toEqual([])
    const rules = await setToolRule(deps, { ...target, decision: 'ask' })
    expect(readPolicy().rules).toEqual([])
    expect(projectRules()).toEqual([])
    // Listed only while a rule named it: with no rule and no configured server, the tool leaves the list.
    expect(find(rules, 'github', 'create_issue')).toBeUndefined()
    expect(audit()).toEqual([
      ['configuration', 'Blocked the MCP tool github/create_issue in .oxespace/policy.json'],
      ['configuration', 'Removed the block on the MCP tool github/create_issue from .oxespace/policy.json'],
      ['rule-added', 'Allow tool github/create_issue'],
      ['configuration', 'Blocked the MCP tool github/create_issue in .oxespace/policy.json'],
      ['rule-removed', 'Removed allow tool github/create_issue'],
      ['configuration', 'Removed the block on the MCP tool github/create_issue from .oxespace/policy.json']
    ])
  })

  it('shows user and managed rules as not editable and never changes them', async () => {
    const { root, userData, deps, policyFile } = project()
    const user = JSON.stringify({ rules: [{ effect: 'deny', action: 'tool.use', resource: 'mcp__github__delete_repository' }] })
    const managed = JSON.stringify({ organization: 'Acme', rules: [{ effect: 'deny', action: 'tool.use', resource: 'mcp__slack__*' }] })
    writeFileSync(join(userData, 'policy.json'), user)
    writeFileSync(join(userData, 'managed.json'), managed)
    new ThreadPermissionStore(deps.db).add({ projectRoot: null, kind: 'tool', pattern: 'linear/create_issue', decision: 'allow' })
    const rules = await toolRules(deps, root)
    expect(find(rules, 'github', 'delete_repository')).toEqual({ server: 'github', tool: 'delete_repository', decision: 'deny', source: 'user', editable: false, allowedDecisions: [], confirmLevel: false, scope: 'everywhere' })
    expect(find(rules, 'linear', 'create_issue')).toMatchObject({ decision: 'allow', source: 'user', editable: false })
    for (const decision of ['ask', 'allow', 'deny'] as const) {
      await expect(setToolRule(deps, { rootPath: root, server: 'github', tool: 'delete_repository', decision })).rejects.toThrow('mcp.toolRule.locked')
    }
    await expect(setToolRule(deps, { rootPath: root, server: 'slack', tool: 'post_message', decision: 'ask' })).rejects.toMatchObject({ code: 'mcp.toolRule.locked', params: { tool: 'slack/post_message' } })
    expect(readFileSync(join(userData, 'policy.json'), 'utf8')).toBe(user)
    expect(readFileSync(join(userData, 'managed.json'), 'utf8')).toBe(managed)
    expect(existsSync(policyFile)).toBe(false)
  })

  it('refuses allow on an OXESpace tool of the confirm level, with its code, writing nothing', async () => {
    const { root, deps, projectRules, audit } = project()
    expect(confirmLevelTools().has('oxespace_db_execute')).toBe(true)
    expect(confirmLevelTools().has('oxespace_project_context')).toBe(false)
    await expect(setToolRule(deps, { rootPath: root, server: 'oxespace-delegation', tool: 'oxespace_db_execute', decision: 'allow' }))
      .rejects.toMatchObject({ code: 'mcp.toolRule.confirmLevel', params: { tool: 'oxespace-delegation/oxespace_db_execute' }, message: 'mcp.toolRule.confirmLevel' })
    expect(projectRules()).toEqual([])
    expect(audit()).toEqual([])
    // Blocking it stays possible, and another server's tool of the same name is not OXESpace's.
    await setToolRule(deps, { rootPath: root, server: 'oxespace-delegation', tool: 'oxespace_db_execute', decision: 'deny' })
    await setToolRule(deps, { rootPath: root, server: 'other', tool: 'oxespace_db_execute', decision: 'allow' })
  })

  it('refuses an unregistered folder and an invalid policy.json, writing nothing', async () => {
    const { root, deps, policyFile, projectRules, audit } = project()
    const stranger = temp('oxe-stranger-')
    await expect(setToolRule(deps, { rootPath: stranger, server: 'github', tool: 'create_issue', decision: 'deny' })).rejects.toThrow('not a project')
    await expect(toolRules(deps, stranger)).rejects.toThrow('not a project')
    expect(existsSync(join(stranger, '.oxespace'))).toBe(false)
    mkdirSync(join(root, '.oxespace'))
    for (const invalid of ['{ not json', '{"rules":[{"effect":"maybe","action":"tool.use","resource":"x"}]}']) {
      writeFileSync(policyFile, invalid)
      for (const decision of ['deny', 'allow', 'ask'] as const) {
        await expect(setToolRule(deps, { rootPath: root, server: 'github', tool: 'create_issue', decision })).rejects.toMatchObject({ code: 'mcp.toolRule.invalidPolicy' })
      }
      expect(readFileSync(policyFile, 'utf8')).toBe(invalid)
    }
    expect(projectRules()).toEqual([])
    expect(audit()).toEqual([])
  })
})
describe('Per-tool rules, CCR from FRONTEND (B7.3)', () => {
  const guard = (...tools: string[]) => JSON.stringify({ pin: { hash: 'x', at: 0 }, tools: tools.map(name => ({ name, hash: name })), quarantine: null })
  const insert = (db: AppDatabase, id: string, workspaceId: string | null, name: string, ...tools: string[]) =>
    db.prepare('INSERT INTO mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, created_at, updated_at, guard_json) VALUES (?, ?, ?, ?, ?, 1, 1, 0, 0, ?)')
      .run(id, workspaceId, name, 'stdio', '{"transport":"stdio","command":"x","args":[],"env":{}}', guard(...tools))
  const userBlock = (userData: string) =>
    writeFileSync(join(userData, 'policy.json'), JSON.stringify({ rules: [{ effect: 'deny', action: 'tool.use', resource: 'mcp__github__delete_repository' }] }))

  it('offers ask and deny for a confirm-level OXESpace tool, nothing for a locked row, and all three otherwise', async () => {
    const { root, userData, deps } = project()
    userBlock(userData)
    const rules = await toolRules(deps, root)
    expect(find(rules, 'oxespace-delegation', 'oxespace_db_execute')).toMatchObject({ editable: true, confirmLevel: true, allowedDecisions: ['ask', 'deny'] })
    expect(find(rules, 'oxespace-delegation', 'oxespace_project_context')).toMatchObject({ confirmLevel: false, allowedDecisions: ['allow', 'ask', 'deny'] })
    expect(find(rules, 'github', 'delete_repository')).toMatchObject({ editable: false, confirmLevel: false, allowedDecisions: [] })
    // Every confirm-level OXESpace tool is marked, and only those; none offers allow.
    const confirm = confirmLevelTools()
    for (const rule of rules) {
      expect(rule.confirmLevel, rule.tool).toBe(rule.server === 'oxespace-delegation' && confirm.has(rule.tool))
      if (rule.confirmLevel) expect(rule.allowedDecisions, rule.tool).toEqual(['ask', 'deny'])
    }
    // Blocked by the project, a confirm-level tool can go back to ask, and still never to allow.
    const blocked = await setToolRule(deps, { rootPath: root, server: 'oxespace-delegation', tool: 'oxespace_db_execute', decision: 'deny' })
    expect(find(blocked, 'oxespace-delegation', 'oxespace_db_execute')).toMatchObject({ decision: 'deny', confirmLevel: true, allowedDecisions: ['ask', 'deny'] })
  })

  it('refuses with a message that is one of the typed codes', async () => {
    const { root, userData, deps, policyFile } = project()
    userBlock(userData)
    const messages: string[] = []
    const refuse = (input: Parameters<typeof setToolRule>[1]) => setToolRule(deps, input).then(
      () => { throw new Error('not refused') },
      (error: Error) => { messages.push(error.message) }
    )
    await refuse({ rootPath: root, server: 'oxespace-delegation', tool: 'oxespace_db_execute', decision: 'allow' })
    await refuse({ rootPath: root, server: 'github', tool: 'delete_repository', decision: 'ask' })
    mkdirSync(join(root, '.oxespace'))
    writeFileSync(policyFile, '{ not json')
    await refuse({ rootPath: root, server: 'github', tool: 'create_issue', decision: 'deny' })
    // B7.4 adds policy.change.pending and project.file.changedMeanwhile, covered in policy-change-gate.test.ts and below.
    expect(messages).toEqual([...MCP_TOOL_RULE_REFUSAL_CODES].filter(code => code.startsWith('mcp.toolRule.')))
    expect(messages.every(isMcpToolRuleRefusal)).toBe(true)
    // An invalid request is not a refusal the window words.
    const invalid = await setToolRule(deps, { rootPath: root, server: 'a__b', tool: 'x', decision: 'deny' }).catch((error: Error) => error.message)
    expect(invalid).toBe('Invalid MCP tool')
    expect(isMcpToolRuleRefusal(invalid)).toBe(false)
  })

  it('lists one row per tool of every configured server, global and the project\'s, under the key the window sees', async () => {
    const { root, db, deps } = project()
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('B', 'B', ?, '1x1', 'builtin-claude')").run(temp('oxe-tool-rules-other-'))
    insert(db, 'g', null, 'My GitHub', 'create_issue', 'list_issues', 'delete_repository')
    insert(db, 'w', 'A', 'Docs Server', 'search', 'fetch')
    insert(db, 'o', 'B', 'Other Project', 'secret_tool')
    insert(db, 'i', null, 'oxespace', 'oxespace_project_context')
    const servers = new McpManager(db)
    const listed = servers.list('A')
    expect(listed.map(server => server.name).sort()).toEqual(['Docs Server', 'My GitHub', 'oxespace'])
    for (const server of listed) expect(server.key, server.name).toBe(serverKey(server.name))
    expect(listed.find(server => server.name === 'My GitHub')?.key).toBe('my-github')

    const rules = await toolRules({ ...deps, servers }, root)
    const of = (key: string) => rules.filter(rule => rule.server === key).map(rule => rule.tool)
    expect(of('my-github')).toEqual(['create_issue', 'delete_repository', 'list_issues'])
    expect(of('docs-server')).toEqual(['fetch', 'search'])
    // Another project's server is not this project's; OXESpace's own is listed once, under its conversation key.
    expect(of('other-project')).toEqual([])
    expect(of('oxespace')).toEqual([])
    for (const rule of rules.filter(rule => rule.server !== 'oxespace-delegation')) {
      expect(rule).toMatchObject({ decision: 'ask', editable: true, allowedDecisions: ['allow', 'ask', 'deny'], confirmLevel: false })
    }
  })
})

describe('Per-tool rules, review fixes (B7.3)', () => {
  const insertAt = (db: AppDatabase, id: string, name: string, createdAt: number, ...tools: string[]) =>
    db.prepare('INSERT INTO mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, created_at, updated_at, guard_json) VALUES (?, NULL, ?, ?, ?, 1, 1, ?, ?, ?)')
      .run(id, name, 'stdio', '{"transport":"stdio","command":"x","args":[],"env":{}}', createdAt, createdAt, JSON.stringify({ pin: { hash: 'x', at: 0 }, tools: tools.map(tool => ({ name: tool, hash: tool })), quarantine: null }))

  it('keys two servers that normalize alike apart, the same in Settings, the conversation and .mcp.json, so a deny reaches the right one', async () => {
    const { root, db, deps } = project()
    insertAt(db, 'first', 'My Server', 1, 'run')
    insertAt(db, 'second', 'my-server', 2, 'run')
    const servers = new McpManager(db)
    expect(servers.list('A').map(server => [server.name, server.key])).toEqual([['My Server', 'my-server'], ['my-server', 'my-server-2']])
    expect(servers.get('second')?.key).toBe('my-server-2')
    const managed = readManagedMcp(db, 'A')
    expect(managed.servers.map(server => server.key).sort()).toEqual(['my-server', 'my-server-2'])
    new McpConfigSync(db).syncWorkspace('A')
    const written = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(Object.keys(written.mcpServers).sort()).toEqual(['my-server', 'my-server-2'])

    // One row per server, under its key; a deny on the second holds for the second only.
    const rules = await toolRules({ ...deps, servers }, root)
    expect(rules.filter(rule => rule.tool === 'run').map(rule => rule.server)).toEqual(['my-server', 'my-server-2'])
    await setToolRule(deps, { rootPath: root, server: 'my-server-2', tool: 'run', decision: 'deny' })
    const denied = policyDeniedToolNames(root)
    expect(denied).toContain('mcp__my-server-2__run')
    expect(denied).not.toContain('mcp__my-server__run')
    expect(threadMcpArguments('claude', [], '/bridge.cjs', managed, [], undefined, denied).join(' ')).toContain('--disallowedTools mcp__my-server-2__run')
    const codex = threadMcpArguments('codex', [], '/bridge.cjs', managed, [], undefined, denied)
    expect(codex).toContain('mcp_servers.my-server-2.disabled_tools=["run"]')
    // Both servers are attached (their own -c entries); only the second has a tool turned off.
    expect(codex.filter(argument => argument.includes('disabled_tools'))).toEqual(['mcp_servers.my-server-2.disabled_tools=["run"]'])
    const after = await toolRules({ ...deps, servers }, root)
    expect(find(after, 'my-server-2', 'run')).toMatchObject({ decision: 'deny', source: 'project', scope: 'everywhere' })
    expect(find(after, 'my-server', 'run')).toMatchObject({ decision: 'ask' })
  })

  it('serves a project that exists only in conversations, with no Code workspace', async () => {
    const { root, db, deps, policyFile, readPolicy, audit } = project('conversation')
    insertAt(db, 'g', 'GitHub', 1, 'create_issue')
    const rules = await toolRules(deps, root)
    expect(find(rules, 'github', 'create_issue')).toMatchObject({ decision: 'ask', source: 'default', editable: true })
    expect(existsSync(join(root, '.oxespace'))).toBe(false)
    const after = await setToolRule(deps, { rootPath: root, server: 'github', tool: 'create_issue', decision: 'deny' })
    expect(readPolicy().rules).toEqual([{ effect: 'deny', action: 'tool.use', resource: 'mcp__github__create_issue' }])
    expect(find(after, 'github', 'create_issue')).toMatchObject({ decision: 'deny', source: 'project', editable: true, scope: 'everywhere' })
    expect(audit()).toEqual([['configuration', 'Blocked the MCP tool github/create_issue in .oxespace/policy.json']])
    expect(policyDeniedToolNames(root)).toContain('mcp__github__create_issue')
    // And back, through the same file.
    await setToolRule(deps, { rootPath: root, server: 'github', tool: 'create_issue', decision: 'ask' })
    expect(readPolicy().rules).toEqual([])
    expect(existsSync(policyFile)).toBe(true)
  })

  it('replaces policy.json atomically and refuses, writing nothing, when the file changed after it was read', async () => {
    const { root, deps, files, policyFile } = project()
    mkdirSync(join(root, '.oxespace'))
    const original = JSON.stringify({ rules: [{ effect: 'deny', action: 'provider.use', resource: 'codex' }] })
    writeFileSync(policyFile, original)
    const meanwhile = JSON.stringify({ rules: [] })
    // Someone saves the file between the read and the replace: the replace's check finds a different mtime.
    const realRead = files.readFile.bind(files)
    vi.spyOn(files, 'readFile').mockImplementationOnce(async input => {
      const read = await realRead(input)
      writeFileSync(policyFile, meanwhile)
      return { ...read, mtimeMs: read.mtimeMs - 1000 }
    })
    await expect(setToolRule(deps, { rootPath: root, server: 'github', tool: 'create_issue', decision: 'deny' })).rejects.toMatchObject({ code: 'project.file.changedMeanwhile' })
    expect(readFileSync(policyFile, 'utf8')).toBe(meanwhile)
    expect(readdirSync(join(root, '.oxespace'))).toEqual(['policy.json'])
  })
})

const settle = () => new Promise(resolve => setTimeout(resolve, 20))
