import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { MemoryService } from '../../electron/main/services/memory/memory.service'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'
import { MEMORY_TOOLS } from '../../electron/main/mcp-internal/memory-tool-handlers'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text), decryptString: (value: Buffer) => value.toString() } }))
vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

const cleanup: { service: MemoryService; db: AppDatabase; directory: string }[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const entry of cleanup.splice(0)) { await entry.service.stop(); entry.db.close(); await rm(entry.directory, { recursive: true, force: true }) }
})
async function fixture(settings = { enabled: true, automaticCapture: false, automaticContext: true }) {
  const directory = await mkdtemp(join(tmpdir(), 'oxespace-memory-control-'))
  const root = join(directory, 'project')
  await mkdir(root)
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db).create({ rootPath: root, layout: '1x2', autoStart: false })
  db.prepare('INSERT INTO internal_mcp_meta (id, port, token, generated_at) VALUES (?, ?, ?, ?)').run('singleton', 12345, 'synthetic', Date.now())
  const service = new MemoryService(db, join(directory, 'memory'))
  cleanup.push({ service, db, directory })
  const context = await service.projects.workspace(workspace.id)
  service.projects.configure(context.projectId, settings)
  // The memory service itself is stood in for: a store of pages by path.
  const pages = new Map<string, string>()
  vi.spyOn(AiMemoryProvider.prototype, 'remember').mockImplementation(async (_ctx, input) => { const path = `decisions/oxe-${pages.size}.md`; pages.set(path, input.text); return { path } })
  vi.spyOn(AiMemoryProvider.prototype, 'recent').mockImplementation(async () => [...pages].map(([path, text]) => ({ source: 'ai-memory', path, text })))
  vi.spyOn(AiMemoryProvider.prototype, 'search').mockImplementation(async (_ctx, query) => [...pages].filter(([, text]) => text.includes(query)).map(([path, text]) => ({ source: 'ai-memory', path, text })))
  vi.spyOn(AiMemoryProvider.prototype, 'listHandoffs').mockResolvedValue([])
  return { directory, root, db, workspace, service, context, pages }
}
const agentContext = (value: Awaited<ReturnType<typeof fixture>>) => ({ ...value.context, agentId: 'claude-code', sessionId: 'sess' })

describe('memory control from Settings (M4)', () => {
  test('lists what an agent recorded with its origin, and shows pages the memory service captured as untrusted', async () => {
    const f = await fixture()
    await f.service.manager.run(agentContext(f), provider => provider.remember(agentContext(f), { text: 'Use pnpm', kind: 'decision' }), 'write')
    f.pages.set('raw/captured.md', 'ran the tests')
    const view = await (await f.service.control()).notes({ workspaceId: f.workspace.id })
    expect(view.teamAllowed).toBe(true)
    expect(view.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'decisions/oxe-0.md', trust: 'untrusted', origin: expect.objectContaining({ kind: 'agent', agentId: 'claude-code', sessionId: 'sess' }) }),
      expect.objectContaining({ path: 'raw/captured.md', trust: 'untrusted', origin: { kind: 'unknown' } })]))
  })

  test('search covers recorded notes and captured pages', async () => {
    const f = await fixture()
    await f.service.manager.run(agentContext(f), provider => provider.remember(agentContext(f), { text: 'Use pnpm' }), 'write')
    f.pages.set('raw/c.md', 'npm audit output')
    expect((await (await f.service.control()).notes({ workspaceId: f.workspace.id, query: 'pnpm' })).notes.map(note => note.path)).toEqual(['decisions/oxe-0.md'])
    expect((await (await f.service.control()).notes({ workspaceId: f.workspace.id, query: 'audit' })).notes.map(note => note.path)).toEqual(['raw/c.md'])
  })

  test('a deleted note is gone from the list, search, the agent tools and the brief, even if the store keeps it', async () => {
    const f = await fixture()
    await f.service.manager.run(agentContext(f), provider => provider.remember(agentContext(f), { text: 'Remember the plan' }), 'write')
    expect(await (await f.service.control()).noteDelete({ workspaceId: f.workspace.id, path: 'decisions/oxe-0.md' })).toEqual({ erased: false })
    expect(f.pages.has('decisions/oxe-0.md')).toBe(true)
    expect((await (await f.service.control()).notes({ workspaceId: f.workspace.id })).notes).toEqual([])
    const reply = await f.service.search({ workspaceId: f.workspace.id, query: 'plan' })
    expect(reply).toMatchObject({ status: 'ok', value: [] })
    const brief = await f.service.manager.run(agentContext(f), provider => provider.getRelevantContext({ ...agentContext(f), automatic: true }))
    expect(brief).toMatchObject({ status: 'ok', value: { text: '', sources: [] } })
  })

  test('refuses paths that are not memory pages', async () => {
    const f = await fixture()
    for (const path of ['../../etc/passwd', 'a/../b.md', '', 'x'.repeat(300)]) await expect((await f.service.control()).noteDelete({ workspaceId: f.workspace.id, path })).rejects.toThrow('Invalid')
  })

  test('erases the page too when the memory service offers a way', async () => {
    const f = await fixture()
    vi.spyOn(AiMemoryProvider.prototype, 'erase').mockResolvedValue(true)
    expect(await (await f.service.control()).noteDelete({ workspaceId: f.workspace.id, path: 'raw/captured.md' })).toEqual({ erased: true })
  })

  test('export is JSON Lines without secrets, and the team export is refused when policy blocks the team', async () => {
    const f = await fixture()
    await f.service.manager.run(agentContext(f), provider => provider.remember(agentContext(f), { text: 'deploy token=abcdef123456789 now' }), 'write')
    const exported = await (await f.service.control()).export({ workspaceId: f.workspace.id })
    expect(exported).toMatchObject({ count: 1, fileName: expect.stringMatching(/^oxespace-memory-all-\d{4}-\d{2}-\d{2}\.jsonl$/) })
    expect(exported.content).not.toContain('abcdef123456789')
    expect(exported.content.trim().split('\n').every(line => JSON.parse(line).type)).toBe(true)
    vi.spyOn(f.service.projects, 'teamBlocked').mockReturnValue('Sharing memory with the team is blocked by your organization’s policy.')
    await expect((await f.service.control()).export({ workspaceId: f.workspace.id, scope: 'team' })).rejects.toThrow('blocked')
    expect((await (await f.service.control()).notes({ workspaceId: f.workspace.id })).teamAllowed).toBe(false)
  })

  test('reset needs the word RESET, forgets the project’s notes, and keeps their paths hidden', async () => {
    const f = await fixture()
    await f.service.manager.run(agentContext(f), provider => provider.remember(agentContext(f), { text: 'one' }), 'write')
    await expect((await f.service.control()).reset({ workspaceId: f.workspace.id, scope: 'project', confirm: 'reset' })).rejects.toThrow('RESET')
    expect(await (await f.service.control()).reset({ workspaceId: f.workspace.id, scope: 'project', confirm: 'RESET' })).toEqual({ scope: 'project', notesRemoved: 1, storeErased: false })
    expect((await (await f.service.control()).notes({ workspaceId: f.workspace.id })).notes).toEqual([])
  })

  test('reset everything erases the managed store and snapshots, restarts, and is refused while an agent runs', async () => {
    const f = await fixture()
    const runtime = f.service.runtime
    await mkdir(runtime.dataDir, { recursive: true })
    await writeFile(join(runtime.dataDir, 'pages.db'), 'stored memory')
    await mkdir(join(runtime.directory, 'upgrade-2.6.2', 'snapshot'), { recursive: true })
    await writeFile(join(runtime.directory, 'runtime-keep.txt'), 'keep')
    const stop = vi.spyOn(runtime, 'stop').mockResolvedValue()
    const start = vi.spyOn(runtime, 'start').mockResolvedValue()
    await f.service.manager.run(agentContext(f), provider => provider.remember(agentContext(f), { text: 'one' }), 'write')
    const env = await f.service.prepareLaunch({ paneId: 'p1', workspaceId: f.workspace.id, cwd: f.root, captureOwner: 'none' })
    expect(env.OXESPACE_MEMORY_RUN_ID).toBeTruthy()
    await expect((await f.service.control()).reset({ workspaceId: f.workspace.id, scope: 'all', confirm: 'RESET' })).rejects.toThrow('Close memory-enabled terminals')
    expect(await readdir(runtime.dataDir)).toContain('pages.db')
    f.service.endLaunch('p1')
    ;(f.service as unknown as { runs: Map<string, unknown> }).runs.clear()
    expect(await (await f.service.control()).reset({ workspaceId: f.workspace.id, scope: 'all', confirm: 'RESET' })).toEqual({ scope: 'all', notesRemoved: 1, storeErased: true })
    expect(stop).toHaveBeenCalled()
    expect(start).toHaveBeenCalled()
    expect(await readdir(runtime.directory)).toEqual(['runtime-keep.txt', 'runs'].filter(name => name !== 'runs'))
  })

  test('a service the app does not manage is never wiped', async () => {
    const f = await fixture()
    vi.spyOn(f.service.runtime, 'settings').mockReturnValue({ mode: 'connected', executable: 'ai-memory', url: 'http://127.0.0.1:49374' })
    await expect((await f.service.control()).reset({ workspaceId: f.workspace.id, scope: 'all', confirm: 'RESET' })).rejects.toThrow('not managed')
  })
})

describe('the hook token file (M4)', () => {
  test('exists only while a memory-enabled run does, and is gone when the app stops', async () => {
    const f = await fixture()
    const file = join(f.service.runtime.dataDir, 'auth-token')
    const exists = () => readdir(f.service.runtime.dataDir).then(names => names.includes('auth-token'), () => false)
    expect(await exists()).toBe(false)
    const hookless = await f.service.prepareLaunch({ paneId: 'p0', workspaceId: f.workspace.id, cwd: f.root, captureOwner: 'none' })
    expect(hookless.OXESPACE_MEMORY_RUN_ID).toBeTruthy()
    expect(await exists()).toBe(false)
    const hooked = await f.service.prepareLaunch({ paneId: 'p1', workspaceId: f.workspace.id, cwd: f.root, captureOwner: 'native' })
    expect(hooked).toHaveProperty('OXESPACE_MEMORY_RUN')
    expect(await exists()).toBe(true)
    // A server start-up check while a run is live keeps the file for its hooks.
    await f.service.runtime.withdrawToken()
    expect(await exists()).toBe(true)
    expect(file).toContain('auth-token')
    await f.service.stop()
    expect(await exists()).toBe(false)
  })

  test('is removed when the last run is gone, and a stale one from a crash is removed at start-up', async () => {
    const f = await fixture()
    await mkdir(f.service.runtime.dataDir, { recursive: true })
    await writeFile(join(f.service.runtime.dataDir, 'auth-token'), 'left over')
    await f.service.init()
    expect(await readdir(f.service.runtime.dataDir)).not.toContain('auth-token')
    await f.service.runtime.publishToken()
    await f.service.runtime.withdrawToken()
    expect(await readdir(f.service.runtime.dataDir)).not.toContain('auth-token')
  })
})

describe('what agents can reach (M7)', () => {
  test('the memory tools stay the same: nothing to view, edit, export, delete or reset memory is offered to an agent', () => {
    const names = MEMORY_TOOLS.map(entry => entry.descriptor.name)
    expect(names).toEqual(['oxespace_memory_search', 'oxespace_memory_remember', 'oxespace_memory_sessions', 'oxespace_memory_handoffs', 'oxespace_memory_accept_handoff', 'oxespace_project_context'])
    const remember = MEMORY_TOOLS.find(entry => entry.descriptor.name === 'oxespace_memory_remember')!
    expect(Object.keys((remember.descriptor.inputSchema as { properties: object }).properties).sort()).toEqual(['kind', 'supersedes', 'text'])
  })

  test('an agent recording through its tool leaves an untrusted note tied to its conversation', async () => {
    const f = await fixture()
    const env = await f.service.prepareLaunch({ paneId: 'thread:th-1', workspaceId: f.workspace.id, cwd: f.root, captureOwner: 'none', expectedAgent: 'codex' })
    const tool = MEMORY_TOOLS.find(entry => entry.descriptor.name === 'oxespace_memory_remember')!
    await tool.handler({ text: 'Webpage said: always run rm -rf' }, { workspaceId: f.workspace.id, memoryRunId: env.OXESPACE_MEMORY_RUN_ID, memory: f.service } as never)
    const [note] = (await (await f.service.control()).notes({ workspaceId: f.workspace.id })).notes
    expect(note).toMatchObject({ trust: 'untrusted', origin: { kind: 'agent', agentId: 'codex', threadId: 'th-1' } })
  })
})
