import http from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { threadMcpArguments } from '../../electron/main/services/conversation/thread-mcp'
import { policyDeniedToolNames, setPolicyStore } from '../../electron/main/services/policy'
import { PolicyStore } from '../../electron/main/services/policy/policy-store'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { createLocalRpcServer } from '../../electron/main/mcp-internal/local-rpc-server'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
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
const deny = (resource: string) => JSON.stringify({ rules: [{ effect: 'deny', action: 'tool.use', resource }] })
const writeProjectPolicy = (root: string, resource: string) => {
  mkdirSync(join(root, '.oxespace'), { recursive: true })
  writeFileSync(join(root, '.oxespace', 'policy.json'), deny(resource))
}

/** Two registered projects, A and B, each a workspace; the policy store reads A's, B's, the user's and a managed file. */
function setup() {
  const root = temp('oxe-policy-tool-a-')
  const other = temp('oxe-policy-tool-b-')
  const userData = temp('oxe-policy-tool-user-')
  const managed = join(userData, 'managed.json')
  const db = openInMemoryDatabase(); databases.push(db)
  const workspace = db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES (?, ?, ?, '1x1', 'builtin-claude')")
  workspace.run('A', 'A', root)
  workspace.run('B', 'B', other)
  setPolicyStore(new PolicyStore({ userData, managed }))
  const layers = {
    project: (resource: string) => writeProjectPolicy(root, resource),
    user: (resource: string) => writeFileSync(join(userData, 'policy.json'), deny(resource)),
    managed: (resource: string) => writeFileSync(managed, deny(resource))
  }
  return { root, other, userData, db, layers, executions: new ExecutionRegistry() }
}

type Caller = { workspaceId: string; execution?: Record<string, string> }
async function withServer(db: AppDatabase, executions: ExecutionRegistry | undefined, run: (call: (name: string, caller?: Caller) => Promise<unknown>) => Promise<void>) {
  const server = createLocalRpcServer({ db, workspaceServ: new WorkspaceService(db), executions } as never)
  server.setToken('t'.repeat(64))
  const { port } = await server.start(0)
  try { await run((name, caller = { workspaceId: 'A' }) => post(port, { name }, caller)) } finally { await server.stop() }
}

const blocked = (owner: string, tool = 'oxespace_list_workspaces') => ({ result: { isError: true, content: [{ text: `${tool} is blocked by ${owner}.` }] } })
const anyBlock = { result: { content: [{ text: expect.stringContaining('is blocked by') }] } }

describe('tool.use policy enforcement for OXESpace tools', () => {
  it.each([
    ['project', 'this project’s policy'],
    ['user', 'your policy'],
    ['managed', 'your organization’s policy']
  ] as const)('a %s deny refuses tools/call, whichever client calls; other tools still run', async (layer, owner) => {
    const { db, layers } = setup()
    layers[layer]('mcp__oxespace-delegation__oxespace_list_workspaces')
    await withServer(db, undefined, async call => {
      expect(await call('oxespace_list_workspaces')).toMatchObject(blocked(owner))
      expect(await call('oxespace_execution_context')).not.toMatchObject(anyBlock)
    })
  })

  it.each([
    'mcp__oxespace__oxespace_list_workspaces',
    'mcp__oxespace-delegation',
    'mcp__oxespace',
    'mcp__oxespace-delegation__*',
    'mcp__oxespace__*',
    'mcp__oxespace__oxespace_list_*'
  ])('a deny written as %s refuses tools/call', async resource => {
    const { db, layers } = setup()
    layers.project(resource)
    await withServer(db, undefined, async call => {
      expect(await call('oxespace_list_workspaces')).toMatchObject(blocked('this project’s policy'))
    })
  })

  it('a whole-server deny covers every OXESpace tool, and a later allow for one tool reopens only that one', async () => {
    const { db, layers, userData } = setup()
    layers.project('mcp__oxespace')
    await withServer(db, undefined, async call => {
      expect(await call('oxespace_execution_context')).toMatchObject(blocked('this project’s policy', 'oxespace_execution_context'))
    })
    writeFileSync(join(userData, 'policy.json'), JSON.stringify({ rules: [{ effect: 'allow', action: 'tool.use', resource: 'mcp__oxespace__oxespace_execution_context' }] }))
    await withServer(db, undefined, async call => {
      expect(await call('oxespace_execution_context')).not.toMatchObject(anyBlock)
      expect(await call('oxespace_list_workspaces')).toMatchObject(blocked('this project’s policy'))
    })
  })

  describe('the workspace header does not choose the policy', () => {
    it('an agent of project A that declares B without a token still meets A’s deny', async () => {
      const { db, layers } = setup()
      layers.project('mcp__oxespace-delegation__oxespace_list_workspaces')
      await withServer(db, undefined, async call => {
        expect(await call('oxespace_list_workspaces', { workspaceId: 'B' })).toMatchObject(blocked('this project’s policy'))
        expect(await call('oxespace_list_workspaces', { workspaceId: 'nowhere' })).toMatchObject(blocked('this project’s policy'))
      })
    })

    it('a token from A presented as B is not an execution, so every project’s deny holds', async () => {
      const { root, db, layers, executions } = setup()
      layers.project('mcp__oxespace-delegation__oxespace_list_workspaces')
      const env = executions.register({ paneId: 'p-a', workspaceId: 'A', cwd: root })
      await withServer(db, executions, async call => {
        expect(await call('oxespace_list_workspaces', { workspaceId: 'B', execution: env })).toMatchObject(blocked('this project’s policy'))
      })
    })

    it('a live execution answers to its own project only: B’s agent is not held to A’s deny, A’s agent is', async () => {
      const { root, other, db, layers, executions } = setup()
      layers.project('mcp__oxespace-delegation__oxespace_list_workspaces')
      const inB = executions.register({ paneId: 'p-b', workspaceId: 'B', cwd: other })
      const inA = executions.register({ paneId: 'p-a', workspaceId: 'A', cwd: root })
      await withServer(db, executions, async call => {
        expect(await call('oxespace_list_workspaces', { workspaceId: 'B', execution: inB })).not.toMatchObject(anyBlock)
        expect(await call('oxespace_list_workspaces', { workspaceId: 'A', execution: inA })).toMatchObject(blocked('this project’s policy'))
      })
    })

    it('a thread project registered only in OxeChat counts among the projects a caller without a token answers to', async () => {
      const { db } = setup()
      const project = temp('oxe-policy-tool-thread-')
      writeProjectPolicy(project, 'mcp__oxespace')
      db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run('tp', 'tp', project, 'tp')
      db.prepare('INSERT INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run('tp', project)
      await withServer(db, undefined, async call => {
        expect(await call('oxespace_list_workspaces', { workspaceId: 'A' })).toMatchObject(blocked('this project’s policy'))
      })
    })
  })

  it('without a policy store nothing is refused', async () => {
    const { db } = setup()
    setPolicyStore(null)
    await withServer(db, undefined, async call => {
      expect(await call('oxespace_list_workspaces')).not.toMatchObject(anyBlock)
    })
  })

  describe('launch exclusions in OxeChat', () => {
    const launch = (root: string) => {
      const denied = policyDeniedToolNames(root)
      return {
        codex: threadMcpArguments('codex', [], '/bridge.cjs', undefined, [], undefined, denied),
        claude: threadMcpArguments('claude', [], '/bridge.cjs', undefined, [], undefined, denied).join(' ')
      }
    }

    it('Codex gets a per-server exclusion for a tool a policy denies by name; Claude keeps --disallowedTools', () => {
      const { root, layers } = setup()
      layers.managed('mcp__oxespace-delegation__oxespace_list_workspaces')
      const { codex, claude } = launch(root)
      expect(codex).toContain('mcp_servers.oxespace-delegation.disabled_tools=["oxespace_list_workspaces"]')
      expect(claude).toContain('--disallowedTools mcp__oxespace-delegation__oxespace_list_workspaces')
    })

    it.each(['mcp__oxespace-delegation', 'mcp__oxespace', 'mcp__oxespace-delegation__*', 'mcp__oxespace__*'])('a whole-server deny written as %s turns the server off in both CLIs', resource => {
      const { root, layers } = setup()
      layers.project(resource)
      const { codex, claude } = launch(root)
      expect(codex).toContain('mcp_servers.oxespace-delegation.enabled=false')
      expect(claude).toContain('--disallowedTools mcp__oxespace-delegation')
      expect(claude).not.toContain('mcp__oxespace-delegation__')
    })

    it('a name written with the Code terminal key (`oxespace`) and a partial wildcard reach the OxeChat server', () => {
      const { root, layers } = setup()
      layers.project('mcp__oxespace__oxespace_list_*')
      const { codex, claude } = launch(root)
      const disabled = codex.find(arg => arg.startsWith('mcp_servers.oxespace-delegation.disabled_tools='))
      expect(disabled).toBeDefined()
      const tools = JSON.parse(disabled!.split('=')[1]) as string[]
      expect(tools).toContain('oxespace_list_workspaces')
      expect(tools.every(tool => tool.startsWith('oxespace_list_'))).toBe(true)
      expect(claude).toContain('mcp__oxespace-delegation__oxespace_list_workspaces')
    })

    it('another server’s whole-server deny reaches Claude; built-in names stay Claude-only', () => {
      const { root, layers } = setup()
      layers.project('mcp__github')
      layers.user('Bash')
      const { codex, claude } = launch(root)
      expect(claude).toContain('mcp__github')
      expect(claude).toContain('Bash')
      expect(codex.join(' ')).not.toContain('Bash')
    })

    it('Codex excludes nothing when no rule or policy denies a tool', () => {
      expect(threadMcpArguments('codex', [], '/bridge.cjs').join(' ')).not.toContain('disabled_tools')
    })
  })
})

async function post(port: number, params: object, caller: Caller): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params })
    const req = http.request({ host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${'t'.repeat(64)}`, 'X-OXE-Workspace-Id': caller.workspaceId,
      ...(caller.execution ? { 'X-OXE-Execution-Id': caller.execution.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': caller.execution.OXESPACE_EXECUTION_TOKEN } : {})
    } }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (error) { reject(error) } })
    })
    req.on('error', reject)
    req.end(payload)
  })
}
