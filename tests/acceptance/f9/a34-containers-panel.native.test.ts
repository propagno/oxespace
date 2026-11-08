// Frozen acceptance test for 1.5.0 A34 / P1 (OXE program, phase F9): the Containers panel's rows. Each row says its
// stack, how long it is up, whether it is a database (so "Connect in OxeQuery" shows only then) and who started it:
// a conversation (from the agents' audit and their own compose or run commands), the person (through OXESpace), or
// unknown. Docker not answering is a state, not an error. Connect never carries a password.
// Written by the planner; the executor must not edit it. A real OxePodService over a fake engine host and a real,
// migrated in-memory database.
// CCR: docs/roadmap-1.5/ccr-f9-panels.md §A34; DESIGN 1.5.0-f9-design.md U9.4.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f9/a34-containers-panel.native.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import type { ExecOptions, ExecResult, ExecutionHost } from '../../../electron/main/runtime/execution-host'
import { OxePodService } from '../../../electron/main/services/oxepod/service'
import type { ConversationThread, ThreadEvent } from '../../../shared/types/thread'

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', timedOut: false })
const ID = { api: 'a'.repeat(64), web: 'b'.repeat(64), pg: 'c'.repeat(64), cache: 'd'.repeat(64) }
const STARTED = Date.parse('2026-11-08T10:00:00Z')
const CONTAINERS = [
  { ID: ID.api, Names: 'shop-api-1', Image: 'node:22', State: 'running', Status: 'Up 2 hours', Ports: '0.0.0.0:3000->3000/tcp', Labels: 'com.docker.compose.project=shop,com.docker.compose.service=api' },
  { ID: ID.web, Names: 'shop-web-1', Image: 'nginx:1.27', State: 'exited', Status: 'Exited (0) 1 hour ago', Ports: '', Labels: 'com.docker.compose.project=shop,com.docker.compose.service=web' },
  { ID: ID.pg, Names: 'pg-dev', Image: 'postgres:16', State: 'running', Status: 'Up 2 hours', Ports: '0.0.0.0:55432->5432/tcp', Labels: '' },
  { ID: ID.cache, Names: 'cache', Image: 'redis:7', State: 'running', Status: 'Up 5 minutes', Ports: '6379/tcp', Labels: '' }
]
const inspectOf = (container: typeof CONTAINERS[number]) => ({
  Id: container.ID, Name: `/${container.Names}`, State: { Status: container.State, StartedAt: container.State === 'running' ? new Date(STARTED).toISOString() : '0001-01-01T00:00:00Z' },
  Config: { Image: container.Image, Env: container.Image.startsWith('postgres') ? ['POSTGRES_USER=app', 'POSTGRES_DB=shop', 'POSTGRES_PASSWORD=s3cret-pw'] : [], Labels: {} },
  NetworkSettings: { Ports: container.Image.startsWith('postgres') ? { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55432' }] } : {}, Networks: {} }, HostConfig: {}, Mounts: []
})

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function fixture(options: { daemon?: 'up' | 'down' | 'missing'; db?: boolean } = {}) {
  const calls: string[][] = []
  const host: ExecutionHost = {
    id: 'fake', kind: 'local',
    exec: vi.fn(async (command: string, args: string[], _options: ExecOptions) => {
      calls.push([command, ...args])
      if (options.daemon === 'missing') return { code: -1, stdout: '', stderr: 'spawn ENOENT', timedOut: false }
      if (args[0] === 'version') return ok(command === 'docker' ? '27.0.0\n' : '')
      if (options.daemon === 'down' && command === 'docker') return { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?', timedOut: false }
      if (args[0] === 'info') return command === 'docker' ? ok('27.0.0\n') : { code: -1, stdout: '', stderr: 'not found', timedOut: false }
      if (args[0] === 'context') return ok('default\n')
      if (args[0] === 'ps') return ok(CONTAINERS.map(container => JSON.stringify(container)).join('\n') + '\n')
      if (args[0] === 'inspect') {
        const wanted = args.filter(arg => /^[a-f0-9]{12,64}$|^[a-z][\w.-]*$/.test(arg) && arg !== 'inspect')
        return ok(JSON.stringify(CONTAINERS.filter(container => wanted.some(id => container.ID.startsWith(id) || container.Names === id)).map(inspectOf)))
      }
      return ok()
    }),
    readTextFile: vi.fn(), writeTextFile: vi.fn()
  }
  let db: AppDatabase | undefined
  if (options.db !== false) {
    db = openInMemoryDatabase()
    databases.push(db)
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'shop', '/work/shop', '1x1', 'builtin-claude')").run()
    db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/work/shop', '/work/shop', 'shop', 1, 1)").run()
  }
  const service = new OxePodService({ host, emit: () => undefined, ...(db ? { db } : {}) })
  /** A conversation row with its own events (the tool calls it made). */
  function conversation(id: string, title: string, provider: 'claude' | 'codex', events: ThreadEvent[] = []) {
    const thread: ConversationThread = { id, workspaceId: 'ws', projectId: 'project', rootPath: '/work/shop', provider, title, pinned: false, status: 'idle', createdAt: 1, updatedAt: 100, generation: 1 }
    db!.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)').run(id, 'ws', 'project', JSON.stringify(thread), JSON.stringify(events))
  }
  const panel = async () => {
    const response = await service.call('containers.panel', {})
    if (!response.ok) throw new Error(JSON.stringify(response.error))
    return response.value as { engine: { state: string; engine?: string }; rows: Array<Record<string, unknown>> }
  }
  const row = (rows: Array<Record<string, unknown>>, name: string) => rows.find(entry => entry.name === name)!
  return { service, db, calls, conversation, panel, row }
}

describe('A34 · the Containers panel', () => {
  test('A34: each row carries its stack, status, uptime, ports and whether it is a database', async () => {
    const f = fixture()
    const { engine, rows } = await f.panel()
    expect(engine).toMatchObject({ state: 'ready', engine: 'docker' })
    expect(rows.map(entry => entry.name)).toEqual(expect.arrayContaining(['shop-api-1', 'shop-web-1', 'pg-dev', 'cache']))
    expect(f.row(rows, 'shop-api-1')).toMatchObject({ id: ID.api, image: 'node:22', status: 'running', stack: 'shop', upSince: STARTED, isDatabase: false })
    expect(f.row(rows, 'shop-web-1')).toMatchObject({ status: 'exited', stack: 'shop', upSince: null })
    expect(f.row(rows, 'pg-dev')).toMatchObject({ status: 'running', stack: null, upSince: STARTED, isDatabase: true, ports: [expect.objectContaining({ hostPort: 55432, containerPort: 5432 })] })
    expect(f.row(rows, 'cache')).toMatchObject({ isDatabase: false })
    // Connect in OxeQuery exists exactly for the database rows, and never carries a password.
    for (const entry of rows) {
      const suggestion = await f.service.call('containers.suggestConnection', { id: entry.id })
      expect(suggestion.ok && suggestion.value !== null, String(entry.name)).toBe(entry.isDatabase)
    }
    expect(JSON.stringify(rows)).not.toContain('s3cret-pw')
  })

  test('A34: Docker not answering, or no engine at all, is a state with no rows, not an error', async () => {
    const down = await fixture({ daemon: 'down' }).panel()
    expect(down).toEqual({ engine: expect.objectContaining({ state: 'stopped' }), rows: [] })
    const missing = await fixture({ daemon: 'missing' }).panel()
    expect(missing).toEqual({ engine: expect.objectContaining({ state: 'missing' }), rows: [] })
  })

  test('A34: who started it: a conversation through the agents\' audit or its own compose or run command, the person through OXESpace, or unknown', async () => {
    const f = fixture()
    // A conversation started the shop stack with its own command, in its project folder.
    f.conversation('t-shop', 'Fix the Pix webhook', 'claude', [
      { type: 'tool', id: 'c1', name: 'Bash', state: 'completed', detail: JSON.stringify({ command: 'docker compose up -d' }, null, 2), exitCode: 0 } as ThreadEvent
    ])
    // Another started the cache through docker run --name.
    f.conversation('t-cache', 'Speed up the catalog', 'codex', [
      { type: 'tool', id: 'c2', name: 'Bash', state: 'completed', detail: JSON.stringify({ command: 'docker run -d --name cache redis:7' }, null, 2), exitCode: 0 } as ThreadEvent
    ])
    // A third asked OXESpace to start pg-dev, which the audit records.
    f.conversation('t-pg', 'Add the refunds table', 'claude')
    f.db!.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (10, 'thread:t-pg', 'container:pg-dev', 'pg-dev', 'postgres', 'local', 'oxespace_container_action', 'start container pg-dev', 'approved', 'ok')").run()
    const { rows } = await f.panel()
    expect(f.row(rows, 'shop-api-1').startedBy).toEqual({ kind: 'conversation', conversationId: 't-shop', title: 'Fix the Pix webhook', provider: 'claude' })
    expect(f.row(rows, 'shop-web-1').startedBy).toEqual({ kind: 'conversation', conversationId: 't-shop', title: 'Fix the Pix webhook', provider: 'claude' })
    expect(f.row(rows, 'cache').startedBy).toEqual({ kind: 'conversation', conversationId: 't-cache', title: 'Speed up the catalog', provider: 'codex' })
    expect(f.row(rows, 'pg-dev').startedBy).toEqual({ kind: 'conversation', conversationId: 't-pg', title: 'Add the refunds table', provider: 'claude' })
    // The person starts pg-dev again through OXESpace: the latest start wins.
    expect(await f.service.call('containers.action', { id: 'pg-dev', action: 'restart' })).toMatchObject({ ok: true })
    expect(f.row((await f.panel()).rows, 'pg-dev').startedBy).toEqual({ kind: 'person' })
  })

  test('A34: a container nobody in OXESpace started, a failed command and another project\'s compose say unknown', async () => {
    const f = fixture()
    f.conversation('t-other', 'Elsewhere', 'claude', [
      // Failed: nothing was started by it.
      { type: 'tool', id: 'c1', name: 'Bash', state: 'failed', detail: JSON.stringify({ command: 'docker run -d --name cache redis:7' }, null, 2), exitCode: 125 } as ThreadEvent,
      // An explicit project name that is not this stack.
      { type: 'tool', id: 'c2', name: 'Bash', state: 'completed', detail: JSON.stringify({ command: 'docker compose -p billing up -d' }, null, 2), exitCode: 0 } as ThreadEvent
    ])
    const { rows } = await f.panel()
    for (const name of ['shop-api-1', 'shop-web-1', 'cache', 'pg-dev']) expect(f.row(rows, name).startedBy, name).toBeNull()
    // The path is live on this fixture: a start through OXESpace is seen.
    await f.service.call('containers.action', { id: 'cache', action: 'start' })
    expect(f.row((await f.panel()).rows, 'cache').startedBy).toEqual({ kind: 'person' })
    // Without the app database (OxeQuery's in-process use), rows still list, with no origin.
    const bare = await fixture({ db: false }).panel()
    expect(bare.rows).toHaveLength(4)
    for (const entry of bare.rows) expect(entry.startedBy).toBeNull()
  })
})
