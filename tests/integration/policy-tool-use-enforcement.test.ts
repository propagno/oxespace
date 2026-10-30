import http from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { threadMcpArguments } from '../../electron/main/services/conversation/thread-mcp'
import { policyDeniedToolNames, setPolicyStore } from '../../electron/main/services/policy'
import { PolicyStore } from '../../electron/main/services/policy/policy-store'
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

function setup() {
  const root = temp('oxe-policy-tool-')
  const userData = temp('oxe-policy-tool-user-')
  const managed = join(userData, 'managed.json')
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  setPolicyStore(new PolicyStore({ userData, managed }))
  const layers = {
    project: (resource: string) => { mkdirSync(join(root, '.oxespace'), { recursive: true }); writeFileSync(join(root, '.oxespace', 'policy.json'), deny(resource)) },
    user: (resource: string) => writeFileSync(join(userData, 'policy.json'), deny(resource)),
    managed: (resource: string) => writeFileSync(managed, deny(resource))
  }
  return { root, db, layers }
}

async function withServer(db: AppDatabase, run: (call: (name: string) => Promise<unknown>) => Promise<void>) {
  const server = createLocalRpcServer({ db, workspaceServ: new WorkspaceService(db) } as never)
  server.setToken('t'.repeat(64))
  const { port } = await server.start(0)
  try { await run(name => post(port, { name })) } finally { await server.stop() }
}

const blocked = (owner: string) => ({ result: { isError: true, content: [{ text: `oxespace_list_workspaces is blocked by ${owner}.` }] } })
const notBlocked = { result: { content: [{ text: expect.stringContaining('blocked') }] } }

describe('tool.use policy enforcement for OXESpace tools', () => {
  it.each([
    ['project', 'this project’s policy'],
    ['user', 'your policy'],
    ['managed', 'your organization’s policy']
  ] as const)('a %s deny refuses tools/call, whichever client calls; other tools still run', async (layer, owner) => {
    const { db, layers } = setup()
    layers[layer]('mcp__oxespace-delegation__oxespace_list_workspaces')
    await withServer(db, async call => {
      expect(await call('oxespace_list_workspaces')).toMatchObject(blocked(owner))
      expect(await call('oxespace_execution_context')).not.toMatchObject(notBlocked)
    })
  })

  it('a deny written with the server key a Code terminal sees (`oxespace`) holds too', async () => {
    const { db, layers } = setup()
    layers.project('mcp__oxespace__oxespace_list_workspaces')
    await withServer(db, async call => {
      expect(await call('oxespace_list_workspaces')).toMatchObject(blocked('this project’s policy'))
    })
  })

  it('without a policy store nothing is refused', async () => {
    const { db } = setup()
    setPolicyStore(null)
    await withServer(db, async call => {
      expect(await call('oxespace_list_workspaces')).not.toMatchObject(notBlocked)
    })
  })

  it('Codex in OxeChat gets a per-server exclusion for a tool a policy denies by name; Claude keeps --disallowedTools', () => {
    const { root, layers } = setup()
    layers.managed('mcp__oxespace-delegation__oxespace_list_workspaces')
    const denied = policyDeniedToolNames(root)
    expect(denied).toContain('mcp__oxespace-delegation__oxespace_list_workspaces')
    expect(threadMcpArguments('codex', [], '/bridge.cjs', undefined, [], undefined, denied)).toContain('mcp_servers.oxespace-delegation.disabled_tools=["oxespace_list_workspaces"]')
    expect(threadMcpArguments('claude', [], '/bridge.cjs', undefined, [], undefined, denied).join(' ')).toContain('--disallowedTools mcp__oxespace-delegation__oxespace_list_workspaces')
  })

  it('Codex excludes nothing when no rule or policy denies a tool', () => {
    expect(threadMcpArguments('codex', [], '/bridge.cjs').join(' ')).not.toContain('disabled_tools')
  })
})

async function post(port: number, params: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params })
    const req = http.request({ host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${'t'.repeat(64)}`, 'X-OXE-Workspace-Id': 'A'
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
