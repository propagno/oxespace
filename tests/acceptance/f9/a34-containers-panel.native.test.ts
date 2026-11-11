// Frozen acceptance test for 1.5.0 A34 / P1 (OXE program, phase F9): the Containers panel's rows. Each row says its
// stack, how long it is up, whether it is a database (so "Connect in OxeQuery" shows only then) and who started it.
// "Who" is matched against the container itself (HML 721-1..4): a compose stack by its own working_dir label against
// the command's resolved folder, a container by its name, and always by Docker's clock: a source counts only when the
// container's StartedAt falls in that source's time window, so a restart outside OXESpace gives unknown. Docker not
// answering is a state, not an error. The rows carry other conversations' titles, so they never reach agents (TECH
// LEAD's reach condition). Written by the planner; the executor must not edit it. A real OxePodService over a fake
// engine host, the real AgentGateway, and a real, migrated in-memory database.
// CCR: docs/roadmap-1.5/ccr-f9-panels.md §A34; DESIGN 1.5.0-f9-design.md U9.4.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f9/a34-containers-panel.native.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { findTool, TOOL_REGISTRY } from '../../../electron/main/mcp-internal/tool-registry'
import type { ExecOptions, ExecResult, ExecutionHost } from '../../../electron/main/runtime/execution-host'
import { ApprovalBroker } from '../../../electron/main/services/agent-actions/approval-broker'
import { OxePodService } from '../../../electron/main/services/oxepod/service'
import { AgentGateway, type GatewayDeps } from '../../../electron/main/services/oxequery/agent-gateway'
import { AuditLog } from '../../../electron/main/services/oxequery/audit-log'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { REMOTE_COMMANDS } from '../../../shared/remote/protocol'
import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import type { ConversationThread, ThreadEvent } from '../../../shared/types/thread'

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', timedOut: false })
const T0 = Date.parse('2026-11-08T10:00:00Z')
const MIN = 60_000
const ROOT = '/work/shop'

interface FakeContainer { name: string; image?: string; state?: string; startedAt: number; project?: string; workingDir?: string; configFile?: string; ports?: string }
let serial = 0
const hex = () => (++serial).toString(16).padStart(64, '0')

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function fixture(containers: FakeContainer[], options: { daemon?: 'up' | 'down' | 'missing'; db?: boolean } = {}) {
  const items = containers.map(container => ({ id: hex(), image: 'alpine:3', state: 'running', ...container }))
  const labels = (item: typeof items[number]) => item.project
    ? { 'com.docker.compose.project': item.project, 'com.docker.compose.project.working_dir': item.workingDir ?? ROOT, 'com.docker.compose.project.config_files': item.configFile ?? `${item.workingDir ?? ROOT}/docker-compose.yml` }
    : {}
  const find = (ref: string) => items.find(item => item.id.startsWith(ref) || item.name === ref)
  const host: ExecutionHost = {
    id: 'fake', kind: 'local',
    exec: vi.fn(async (command: string, args: string[], _options: ExecOptions) => {
      if (options.daemon === 'missing') return { code: -1, stdout: '', stderr: 'spawn ENOENT', timedOut: false }
      if (args[0] === 'version') return ok(command === 'docker' ? '27.0.0\n' : '')
      if (options.daemon === 'down' && command === 'docker') return { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?', timedOut: false }
      if (args[0] === 'info') return command === 'docker' ? ok('27.0.0\n') : { code: -1, stdout: '', stderr: 'not found', timedOut: false }
      if (args[0] === 'context') return ok('default\n')
      if (args[0] === 'ps') {
        return ok(items.map(item => JSON.stringify({ ID: item.id, Names: item.name, Image: item.image, State: item.state, Status: item.state === 'running' ? 'Up' : 'Exited (0)', Ports: item.ports ?? '', Labels: Object.entries(labels(item)).map(([key, value]) => `${key}=${value}`).join(',') })).join('\n') + '\n')
      }
      if (args[0] === 'inspect') {
        const found = args.slice(1).map(find).filter((item): item is typeof items[number] => Boolean(item))
        return ok(JSON.stringify(found.map(item => ({
          Id: item.id, Name: `/${item.name}`, State: { Status: item.state, StartedAt: new Date(item.startedAt).toISOString() },
          Config: { Image: item.image, Env: item.image.startsWith('postgres') ? ['POSTGRES_USER=app', 'POSTGRES_DB=shop', 'POSTGRES_PASSWORD=s3cret-pw'] : [], Labels: labels(item) },
          NetworkSettings: { Ports: item.image.startsWith('postgres') ? { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55432' }] } : {}, Networks: {} }, HostConfig: {}, Mounts: []
        }))))
      }
      // Docker's clock moves when OXESpace starts or restarts a container.
      if (args[0] === 'start' || args[0] === 'restart') { const item = find(args[args.length - 1]); if (item) { item.startedAt = Date.now(); item.state = 'running' } }
      return ok()
    }),
    readTextFile: vi.fn(), writeTextFile: vi.fn()
  }
  let db: AppDatabase | undefined
  if (options.db !== false) {
    db = openInMemoryDatabase()
    databases.push(db)
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'shop', ?, '1x1', 'builtin-claude')").run(ROOT)
    db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', ?, ?, 'shop', 1, 1)").run(ROOT, ROOT)
  }
  const service = new OxePodService({ host, emit: () => undefined, ...(db ? { db } : {}) })
  /** A conversation rooted at `root`, with the shell commands it ran: [command, began, ended?, exit?, state?]. */
  function conversation(id: string, title: string, provider: 'claude' | 'codex', commands: Array<{ command: string; began: number; ended?: number; exit?: number; state?: 'completed' | 'failed' | 'running'; interrupted?: boolean }>, root = ROOT) {
    const events: ThreadEvent[] = commands.map((entry, index) => ({
      type: 'tool', id: `${id}-${index}`, name: 'Bash', state: entry.state ?? 'completed', detail: JSON.stringify({ command: entry.command }, null, 2),
      startedAt: entry.began, ...(entry.ended === undefined ? {} : { completedAt: entry.ended }), ...(entry.exit === undefined ? {} : { exitCode: entry.exit }), ...(entry.interrupted ? { interrupted: true } : {})
    }) as ThreadEvent)
    const thread: ConversationThread = { id, workspaceId: 'ws', projectId: 'project', rootPath: root, provider, title, pinned: false, status: 'idle', createdAt: 1, updatedAt: 100, generation: 1 }
    db!.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)').run(id, 'ws', 'project', JSON.stringify(thread), JSON.stringify(events))
  }
  const panel = async () => {
    const response = await service.call('containers.panel', {})
    if (!response.ok) throw new Error(JSON.stringify(response.error))
    return response.value as { engine: { state: string; engine?: string }; rows: Array<Record<string, unknown>> }
  }
  const startedBy = async (name: string) => (await panel()).rows.find(entry => entry.name === name)!.startedBy
  return { service, db, items, conversation, panel, startedBy }
}
const by = (conversationId: string, title: string, provider: 'claude' | 'codex' = 'claude') => ({ kind: 'conversation', conversationId, title, provider })

describe('A34 · the Containers panel', () => {
  test('A34: each row carries its stack, status, uptime, ports and whether it is a database', async () => {
    const f = fixture([
      { name: 'shop-api-1', image: 'node:22', startedAt: T0, project: 'shop', ports: '0.0.0.0:3000->3000/tcp' },
      { name: 'shop-web-1', image: 'nginx:1.27', state: 'exited', startedAt: T0, project: 'shop' },
      { name: 'pg-dev', image: 'postgres:16', startedAt: T0, ports: '0.0.0.0:55432->5432/tcp' },
      { name: 'cache', image: 'redis:7', startedAt: T0, ports: '6379/tcp' }
    ])
    const { engine, rows } = await f.panel()
    const row = (name: string) => rows.find(entry => entry.name === name)!
    expect(engine).toMatchObject({ state: 'ready', engine: 'docker' })
    expect(rows).toHaveLength(4)
    expect(row('shop-api-1')).toMatchObject({ image: 'node:22', status: 'running', stack: 'shop', upSince: T0, isDatabase: false })
    expect(row('shop-web-1')).toMatchObject({ status: 'exited', stack: 'shop', upSince: null })
    expect(row('pg-dev')).toMatchObject({ status: 'running', stack: null, upSince: T0, isDatabase: true, ports: [expect.objectContaining({ hostPort: 55432, containerPort: 5432 })] })
    expect(row('cache')).toMatchObject({ isDatabase: false })
    // Connect in OxeQuery exists exactly for the database rows, and never carries a password.
    for (const entry of rows) {
      const suggestion = await f.service.call('containers.suggestConnection', { id: entry.id })
      expect(suggestion.ok && suggestion.value !== null, String(entry.name)).toBe(entry.isDatabase)
    }
    expect(JSON.stringify(rows)).not.toContain('s3cret-pw')
  })

  test('A34: Docker not answering, or no engine at all, is a state with no rows, not an error', async () => {
    expect(await fixture([{ name: 'x', startedAt: T0 }], { daemon: 'down' }).panel()).toEqual({ engine: expect.objectContaining({ state: 'stopped' }), rows: [] })
    expect(await fixture([{ name: 'x', startedAt: T0 }], { daemon: 'missing' }).panel()).toEqual({ engine: expect.objectContaining({ state: 'missing' }), rows: [] })
  })
})

describe('A34 · who started it', () => {
  test('A34: a compose stack is matched by its own working_dir label against the command\'s resolved folder: -f, cd, a name: key, and a same-named folder elsewhere (HML 721-1)', async () => {
    const f = fixture([
      // compose -f infra/docker-compose.yml: the project is named after the file's folder.
      { name: 'infra-db-1', startedAt: T0 + MIN, project: 'infra', workingDir: `${ROOT}/infra`, configFile: `${ROOT}/infra/docker-compose.yml` },
      // A top-level name: in the file; the folder is the conversation's own.
      { name: 'billing-api-1', startedAt: T0 + 3 * MIN, project: 'billing', workingDir: ROOT },
      // cd services/api && docker compose up.
      { name: 'api-worker-1', startedAt: T0 + 5 * MIN, project: 'api', workingDir: `${ROOT}/services/api` },
      // Another checkout with the same folder name.
      { name: 'shop-web-1', startedAt: T0 + 7 * MIN, project: 'shop', workingDir: '/other/shop' }
    ])
    f.conversation('t-1', 'Fix the Pix webhook', 'claude', [
      { command: 'docker compose -f infra/docker-compose.yml up -d', began: T0 + MIN - 2000, ended: T0 + MIN + 5000, exit: 0 },
      { command: 'docker compose up -d', began: T0 + 3 * MIN - 2000, ended: T0 + 3 * MIN + 5000, exit: 0 },
      { command: 'cd services/api && docker compose up -d', began: T0 + 5 * MIN - 2000, ended: T0 + 5 * MIN + 5000, exit: 0 },
      { command: 'docker compose up -d', began: T0 + 7 * MIN - 2000, ended: T0 + 7 * MIN + 5000, exit: 0 }
    ])
    expect(await f.startedBy('infra-db-1')).toEqual(by('t-1', 'Fix the Pix webhook'))
    expect(await f.startedBy('billing-api-1')).toEqual(by('t-1', 'Fix the Pix webhook'))
    expect(await f.startedBy('api-worker-1')).toEqual(by('t-1', 'Fix the Pix webhook'))
    expect(await f.startedBy('shop-web-1')).toBeNull()
  })

  test('A34: every spelling of a start is recognised: compose v1, podman, docker start and restart, container run, --name= and a sudo prefix (HML 721-2)', async () => {
    const cases: Array<[string, FakeContainer]> = [
      ['docker-compose up -d', { name: 'v1-app-1', startedAt: 0, project: 'v1', workingDir: ROOT }],
      ['podman-compose up -d', { name: 'pc-app-1', startedAt: 0, project: 'pc', workingDir: ROOT }],
      ['podman run -d --name pod-cache redis:7', { name: 'pod-cache', startedAt: 0 }],
      ['docker start pg-old', { name: 'pg-old', startedAt: 0 }],
      ['docker restart queue', { name: 'queue', startedAt: 0 }],
      ['docker container run -d --name=search elasticsearch:8', { name: 'search', startedAt: 0 }],
      ['sudo docker run -d --name mail mailhog/mailhog', { name: 'mail', startedAt: 0 }]
    ]
    const f = fixture(cases.map(([, container], index) => ({ ...container, startedAt: T0 + index * 2 * MIN })))
    f.conversation('t-2', 'Speed up the catalog', 'codex', cases.map(([command], index) => ({ command, began: T0 + index * 2 * MIN - 2000, ended: T0 + index * 2 * MIN + 3000, exit: 0 })))
    for (const [command, container] of cases) expect(await f.startedBy(container.name), command).toEqual(by('t-2', 'Speed up the catalog', 'codex'))
  })

  test('A34: a compose up that never completes or ends with 130 or 143 still started them; a command that failed before the start did not (HML 721-3)', async () => {
    const f = fixture([
      { name: 'fg-app-1', startedAt: T0 + 10_000, project: 'fg', workingDir: ROOT },
      { name: 'int-app-1', startedAt: T0 + 2 * MIN + 10_000, project: 'int', workingDir: `${ROOT}/int` },
      { name: 'cache', startedAt: T0 + 30 * MIN }
    ])
    f.conversation('t-3', 'Run the stack', 'claude', [
      // Still in the foreground: no end yet.
      { command: 'docker compose up', began: T0, state: 'running' },
      // Interrupted with Ctrl+C.
      { command: 'cd int && docker compose up', began: T0 + 2 * MIN, ended: T0 + 4 * MIN, exit: 130, state: 'failed' },
      // Failed at once, long before cache started.
      { command: 'docker run -d --name cache redis:7', began: T0 + 5 * MIN, ended: T0 + 5 * MIN + 500, exit: 125, state: 'failed' }
    ])
    expect(await f.startedBy('fg-app-1')).toEqual(by('t-3', 'Run the stack'))
    expect(await f.startedBy('int-app-1')).toEqual(by('t-3', 'Run the stack'))
    expect(await f.startedBy('cache')).toBeNull()
  })

  test('A34: the agents\' audit and the person through OXESpace count when Docker\'s clock agrees; a later restart outside OXESpace gives unknown (HML 721-4)', async () => {
    const f = fixture([{ name: 'pg-dev', image: 'postgres:16', startedAt: T0 + 10_000 }, { name: 'cache', image: 'redis:7', startedAt: T0 + 90 * MIN }])
    f.conversation('t-pg', 'Add the refunds table', 'claude', [])
    const audit = f.db!.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (?, 'thread:t-pg', ?, ?, 'postgres', 'local', 'oxespace_container_action', ?, 'approved', 'ok')")
    audit.run(T0 + 8000, 'container:pg-dev', 'pg-dev', 'start container pg-dev')
    // The audit says t-pg started cache too, but Docker started it again an hour later, outside OXESpace.
    audit.run(T0 + 8000, 'container:cache', 'cache', 'start container cache')
    expect(await f.startedBy('pg-dev')).toEqual(by('t-pg', 'Add the refunds table'))
    expect(await f.startedBy('cache')).toBeNull()
    // The person restarts pg-dev through OXESpace: Docker's clock moves, and the person is the latest.
    expect(await f.service.call('containers.action', { id: 'pg-dev', action: 'restart' })).toMatchObject({ ok: true })
    expect(await f.startedBy('pg-dev')).toEqual({ kind: 'person' })
    // Without the app database (OxeQuery's in-process use), rows still list, with no origin.
    const bare = await fixture([{ name: 'cache', startedAt: T0 }], { db: false }).panel()
    expect(bare.rows).toEqual([expect.objectContaining({ name: 'cache', startedBy: null })])
  })
})

describe('A34 · reach (SECURITY, TECH LEAD)', () => {
  test('A34 (SECURITY): the panel is the window\'s only: no agent tool, forbidden in MCP coverage, never a phone command', () => {
    // The path is live: the registry and the coverage are populated, and container tools exist.
    expect(findTool('oxespace_containers_list')).not.toBeNull()
    expect(TOOL_REGISTRY.some(tool => /containers?[ _.]panel|started_?by/i.test(JSON.stringify(tool.descriptor)))).toBe(false)
    expect(findTool('oxespace_containers_panel')).toBeNull()
    const claimed = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes('oxePod.containers.panel'))
    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toHaveProperty('forbidden')
    expect((REMOTE_COMMANDS as readonly string[]).some(command => /container|oxePod/i.test(command))).toBe(false)
  })

  test('A34 (SECURITY): what agents reach never carries who started a container or another conversation\'s title', async () => {
    const f = fixture([{ name: 'cache', image: 'redis:7', startedAt: T0 + 10_000 }])
    f.conversation('t-secret', 'Rotate the payment keys', 'claude', [{ command: 'docker run -d --name cache redis:7', began: T0, ended: T0 + 15_000, exit: 0 }])
    // The path is live: the window's panel does show the origin and the title.
    expect(await f.startedBy('cache')).toEqual(by('t-secret', 'Rotate the payment keys'))
    const connection = { id: 'c1', name: 'cache', engine: 'postgres', environment: 'dev', readOnly: false, agentAccess: 'read', containerRef: 'cache' } as OxeQueryConnection
    const deps: GatewayDeps = {
      list: () => [connection],
      resolve: id => ({ id, engine: 'postgres', host: 'h', port: 1, database: 'd', username: 'u', password: 'x', sslMode: 'disable', readOnly: false }),
      call: async () => ({}) as never,
      containers: f.service.containers,
      broker: new ApprovalBroker({ ask: async () => 'allow-once' }),
      audit: new AuditLog(f.db!)
    }
    const gateway = new AgentGateway(deps)
    const listed = await gateway.handle('oxespace_containers_list', {}, { key: 'exec-1', label: 'thread:other' })
    expect(JSON.stringify(listed)).toContain('cache')
    for (const reached of [listed, await f.service.call('containers.list', {})]) {
      expect(JSON.stringify(reached)).not.toMatch(/startedBy|Rotate the payment keys|t-secret/)
    }
  })
})
