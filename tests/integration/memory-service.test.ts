import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { MemoryService } from '../../electron/main/services/memory/memory.service'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'
import type { ThreadSnapshot } from '../../shared/types/thread'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text), decryptString: (value: Buffer) => value.toString() } }))
const cleanup: { service: MemoryService; db: AppDatabase; directory: string }[] = []
afterEach(async () => {
  for (const entry of cleanup.splice(0)) { await entry.service.stop(); entry.db.close(); await rm(entry.directory, { recursive: true, force: true }) }
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'oxespace-memory-service-test-'))
  const root = join(directory, 'project')
  await mkdir(root)
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db).create({ rootPath: root, layout: '1x2', autoStart: false })
  db.prepare('INSERT INTO internal_mcp_meta (id, port, token, generated_at) VALUES (?, ?, ?, ?)').run('singleton', 12345, 'synthetic', Date.now())
  const service = new MemoryService(db, join(directory, 'memory'))
  vi.spyOn(service.adapters, 'finalize').mockResolvedValue()
  cleanup.push({ service, db, directory })
  const context = await service.projects.workspace(workspace.id)
  service.projects.configure(context.projectId, { enabled: true, automaticCapture: true, automaticContext: false })
  return { directory, root, db, workspace, service, context }
}
describe('execution-scoped memory facade', () => {
  test('a runtime change cannot mint a capture lease while the data snapshot is moving', async () => {
    const { workspace, service, root, context } = await fixture()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const configure = vi.spyOn(service.runtime, 'configure').mockReturnValue(pending)
    vi.spyOn(service.runtime, 'start').mockResolvedValue()
    const operation = service.configure({ workspaceId: workspace.id, settings: service.projects.settings(context.projectId),
      runtime: { mode: 'managed', executable: 'synthetic-upgrade', url: 'http://127.0.0.1:49374' } })
    await vi.waitFor(() => expect(configure).toHaveBeenCalledTimes(1))
    expect(await service.prepareLaunch({ paneId: 'thread:blocked', workspaceId: workspace.id, cwd: root, captureOwner: 'native' })).toEqual({})
    release()
    await operation
    expect(await service.prepareLaunch({ paneId: 'thread:allowed', workspaceId: workspace.id, cwd: root, captureOwner: 'native' })).toHaveProperty('OXESPACE_MEMORY_RUN')
  })
  test('status reports observable pipeline stages and leaves consolidation unknown', async () => {
    const { workspace, service, context } = await fixture()
    vi.spyOn(service.runtime, 'client').mockImplementation(() => { throw new Error('offline') })
    const enabled = await service.status(workspace.id)
    expect(enabled.health.pipeline).toEqual({ capture: 'active', delivery: 'idle', consolidation: 'unknown' })
    service.projects.configure(context.projectId, { enabled: true, automaticCapture: false, automaticContext: false })
    expect((await service.status(workspace.id)).health.pipeline).toMatchObject({ capture: 'disabled', consolidation: 'unknown' })
    service.projects.configure(context.projectId, { enabled: false, automaticCapture: false, automaticContext: false })
    expect((await service.status(workspace.id)).health.pipeline).toEqual({ capture: 'disabled', delivery: 'unknown', consolidation: 'unknown' })
  })
  test('handoff reads never consume and accept forwards exactly the chosen id', async () => {
    const { workspace, service } = await fixture()
    const offers = [{ id: 'a', summary: 'A', state: 'open', nextSteps: [], openQuestions: [], filesTouched: [] }, { id: 'b', summary: 'B', state: 'open', nextSteps: [], openQuestions: [], filesTouched: [] }]
    vi.spyOn(AiMemoryProvider.prototype, 'listHandoffs').mockImplementation(async () => offers)
    const accept = vi.spyOn(AiMemoryProvider.prototype, 'acceptHandoff').mockImplementation(async () => { offers[1].state = 'accepted'; return {} })
    expect(await service.handoffs(workspace.id)).toMatchObject({ status: 'ok', value: [{ id: 'a' }, { id: 'b' }] })
    expect(accept).not.toHaveBeenCalled()
    const accepted = await service.acceptHandoff({ workspaceId: workspace.id, handoffId: 'b' })
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ project: expect.any(String) }), 'b')
    expect(accepted).toMatchObject({ status: 'ok', value: { id: 'b', state: 'accepted' } })
  })
  test('a failed or stale accept is reported as unavailable without a success', async () => {
    const { workspace, service } = await fixture()
    vi.spyOn(AiMemoryProvider.prototype, 'acceptHandoff').mockRejectedValue(new Error('Handoff offer not found'))
    expect(await service.acceptHandoff({ workspaceId: workspace.id, handoffId: 'gone' })).toMatchObject({ status: 'unavailable' })
  })
  test('hookless Thread has a scoped MCP run but cannot claim native capture', async () => {
    const { workspace, service, root } = await fixture()
    const env = await service.prepareLaunch({ paneId: `thread:synthetic`, workspaceId: workspace.id, cwd: root,
      captureOwner: 'none', expectedAgent: 'claude-code' })
    expect(env.OXESPACE_MEMORY_RUN_ID).toBeTruthy()
    expect(env).not.toHaveProperty('OXESPACE_MEMORY_RUN')
    expect(await service.observe({ runId: env.OXESPACE_MEMORY_RUN_ID, sessionId: 'native-a', agent: 'claude-code', cwd: root, event: 'session-start' })).toEqual({ allowed: false })
    expect(service.observations(env.OXESPACE_MEMORY_RUN_ID, workspace.id, 'thread:synthetic').observedSessions).toBe(0)
    service.endLaunch('thread:synthetic')
    await service.stop()
    expect(service.adapters.finalize).not.toHaveBeenCalled()
  })
  test('external Thread admits one ordered producer without a native capture lease or synthesized SessionEnd', async () => {
    const { workspace, service, root } = await fixture()
    vi.spyOn(service.runtime, 'version').mockResolvedValue('2.6.2')
    vi.spyOn(service.delivery, 'wake').mockImplementation(() => {})
    vi.spyOn(service as never, 'capturePolicy').mockResolvedValue({ policy_admits_capture: true, disposition: 'keep', scope_resolution: 'explicit' } as never)
    const env = await service.prepareLaunch({ paneId: 'thread:synthetic', workspaceId: workspace.id, cwd: root,
      captureOwner: 'external', expectedAgent: 'codex' })
    expect(env.AI_MEMORY_CAPTURE_OWNER).toBe('oxespace.thread')
    expect(env).not.toHaveProperty('OXESPACE_MEMORY_RUN')
    expect(await service.observe({ runId: env.OXESPACE_MEMORY_RUN_ID, sessionId: 'native-1', agent: 'codex', cwd: root, event: 'session-start' })).toEqual({ allowed: false })
    const thread = { id: 'synthetic', workspaceId: workspace.id, projectId: 'project', rootPath: root, provider: 'codex', nativeSessionId: 'native-1' }
    const prompt = { type: 'message' as const, id: 'turn-1', role: 'user' as const, text: 'Use token=very-secret in the example.' }
    const snapshot = { thread, turns: [{ id: 'turn-1', sequence: 1, status: 'running', configuration: {} }], events: [prompt] } as ThreadSnapshot
    service.observeThread(snapshot, { type: 'session', nativeSessionId: 'native-1' })
    service.observeThread(snapshot, { type: 'turn-accepted', nativeTurnId: 'native-turn-1', at: Date.now() })
    snapshot.events.push({ type: 'message', id: 'answer-1', role: 'assistant', text: 'Fixed the issue. token=other-secret' })
    service.observeThread(snapshot, { type: 'completed', status: 'completed' })
    await vi.waitFor(async () => expect((await service.outbox.pending()).length).toBe(3), { timeout: 5000 })
    const items = await service.outbox.pending()
    expect(items.map(value => new URL(value.item.url, 'http://localhost').searchParams.get('event'))).toEqual(['session-start', 'user-prompt-submit', 'stop'])
    expect(items[1].item.body.prompt).not.toContain('very-secret')
    expect(items[2].item.body._ai_memory_assistant?.excerpt).toContain('Fixed the issue')
    expect(items[2].item.body._ai_memory_assistant?.excerpt).not.toContain('other-secret')
    expect(new URL(items[2].item.url, 'http://localhost').searchParams.get('capture_assistant')).toBe('1')
    expect(items.every(value => value.item.body.session_id === 'native-1')).toBe(true)
    service.endLaunch('thread:synthetic')
    await service.stop()
    expect(service.adapters.finalize).not.toHaveBeenCalled()
  }, 15000)
  test('interruption, reconnection and child sessions keep independent native identities', async () => {
    const { workspace, service, root } = await fixture()
    vi.spyOn(service.runtime, 'version').mockResolvedValue('2.6.2')
    vi.spyOn(service.delivery, 'wake').mockImplementation(() => {})
    vi.spyOn(service as never, 'capturePolicy').mockResolvedValue({ policy_admits_capture: true, disposition: 'keep', scope_resolution: 'explicit' } as never)
    const launch = (id: string) => service.prepareLaunch({ paneId: `thread:${id}`, workspaceId: workspace.id, cwd: root, captureOwner: 'external', expectedAgent: 'codex' })
    const snapshot = (id: string, nativeSessionId: string, turnId: string) => ({
      thread: { id, workspaceId: workspace.id, projectId: 'project', rootPath: root, provider: 'codex', nativeSessionId },
      turns: [{ id: turnId, sequence: 1, nativeId: `native-${turnId}`, status: 'running', configuration: {} }],
      events: [{ type: 'message', id: turnId, role: 'user', text: `Prompt ${turnId}` }]
    } as ThreadSnapshot)
    await launch('parent'); await launch('child')
    const parent = snapshot('parent', 'session-parent', 'turn-interrupted')
    const child = snapshot('child', 'session-child', 'turn-child')
    service.observeThread(parent, { type: 'turn-accepted', nativeTurnId: 'native-turn-interrupted', at: Date.now() })
    service.observeThread(parent, { type: 'completed', status: 'interrupted' })
    service.observeThread(child, { type: 'turn-accepted', nativeTurnId: 'native-turn-child', at: Date.now() })
    service.observeThread(child, { type: 'completed', status: 'completed' })
    await vi.waitFor(async () => expect((await service.outbox.pending()).length).toBe(5), { timeout: 5000 })
    service.endLaunch('thread:parent')
    await launch('parent')
    const continued = snapshot('parent', 'session-parent', 'turn-resumed')
    service.observeThread(continued, { type: 'turn-accepted', nativeTurnId: 'native-turn-resumed', at: Date.now() })
    service.observeThread(continued, { type: 'completed', status: 'completed' })
    await vi.waitFor(async () => expect((await service.outbox.pending()).length).toBe(7), { timeout: 5000 })
    const records = await service.outbox.pending()
    const events = records.map(value => ({ session: value.sessionId, event: new URL(value.item.url, 'http://localhost').searchParams.get('event') }))
    expect(events.filter(value => value.session === 'session-parent').map(value => value.event)).toEqual(['session-start', 'user-prompt-submit', 'user-prompt-submit', 'stop'])
    expect(events.filter(value => value.session === 'session-child').map(value => value.event)).toEqual(['session-start', 'user-prompt-submit', 'stop'])
    expect(events.some(value => value.event === 'session-end')).toBe(false)
    await service.stop()
    expect(service.adapters.finalize).not.toHaveBeenCalled()
  }, 15000)
  test('Claude prompt is admitted when its native session arrives without turn-accepted', async () => {
    const { workspace, service, root } = await fixture()
    vi.spyOn(service.runtime, 'version').mockResolvedValue('2.6.2')
    vi.spyOn(service.delivery, 'wake').mockImplementation(() => {})
    vi.spyOn(service as never, 'capturePolicy').mockResolvedValue({ policy_admits_capture: true, disposition: 'keep', scope_resolution: 'explicit' } as never)
    await service.prepareLaunch({ paneId: 'thread:claude', workspaceId: workspace.id, cwd: root, captureOwner: 'external', expectedAgent: 'claude-code' })
    const snapshot = { thread: { id: 'claude', workspaceId: workspace.id, projectId: 'project', rootPath: root, provider: 'claude', nativeSessionId: 'claude-session' },
      turns: [{ id: 'turn-1', sequence: 1, status: 'running', configuration: {} }],
      events: [{ type: 'message', id: 'turn-1', role: 'user', text: 'Complete the task.' }] } as ThreadSnapshot
    service.observeThread(snapshot, { type: 'session', nativeSessionId: 'claude-session' })
    if (snapshot.events[0].type === 'message') snapshot.events[0].text = 'Mutated later turn.'
    await vi.waitFor(async () => expect((await service.outbox.pending()).length).toBe(2), { timeout: 5000 })
    expect((await service.outbox.pending()).map(value => new URL(value.item.url, 'http://localhost').searchParams.get('event'))).toEqual(['session-start', 'user-prompt-submit'])
    expect((await service.outbox.pending())[1].item.body.prompt).toBe('Complete the task.')
  }, 10000)
  test('native capture is limited to the selected provider on that launch', async () => {
    const { workspace, service, root } = await fixture()
    const env = await service.prepareLaunch({ paneId: `thread:synthetic`, workspaceId: workspace.id, cwd: root,
      captureOwner: 'native', expectedAgent: 'codex' })
    expect(env.OXESPACE_MEMORY_RUN).toBeTruthy()
    expect(await service.observe({ runId: env.OXESPACE_MEMORY_RUN_ID, sessionId: 'native-a', agent: 'claude-code', cwd: root, event: 'session-start' })).toEqual({ allowed: false })
    expect(await service.observe({ runId: env.OXESPACE_MEMORY_RUN_ID, sessionId: 'native-a', agent: 'codex', cwd: root, event: 'session-start' })).toMatchObject({ allowed: true, capture: true })
  })
  test('independent runs keep native sessions and closing one cannot close the other', async () => {
    const { workspace, service, root } = await fixture()
    const [a, b] = await Promise.all(workspace.panes.map(pane => service.prepareLaunch({ paneId: pane.id, workspaceId: workspace.id, cwd: root })))
    expect(a.OXESPACE_MEMORY_RUN_ID).not.toBe(b.OXESPACE_MEMORY_RUN_ID)
    const event = { sessionId: 'claude-A', agent: 'claude-code', cwd: root, event: 'session-start' }
    expect(await service.observe({ ...event, runId: a.OXESPACE_MEMORY_RUN_ID })).toMatchObject({ allowed: true, capture: true, context: false })
    expect(service.observations(a.OXESPACE_MEMORY_RUN_ID, workspace.id, workspace.panes[0].id)).toMatchObject({ lastHookAt: expect.any(Number), lastHookEvent: 'session-start' })
    expect(() => service.observations(a.OXESPACE_MEMORY_RUN_ID, workspace.id, workspace.panes[1].id)).toThrow()
    await service.observe({ ...event, runId: b.OXESPACE_MEMORY_RUN_ID, sessionId: 'codex-B', agent: 'codex' })
    const first = await service.contextForRun(a.OXESPACE_MEMORY_RUN_ID, workspace.id)
    const second = await service.contextForRun(b.OXESPACE_MEMORY_RUN_ID, workspace.id)
    expect(first.projectId).toBe(second.projectId)
    expect(first.sessionId).toBe('claude-A')
    expect(second.sessionId).toBe('codex-B')
    service.endLaunch(workspace.panes[0].id)
    await expect(service.contextForRun(a.OXESPACE_MEMORY_RUN_ID, workspace.id)).rejects.toThrow('live')
    expect((await service.contextForRun(b.OXESPACE_MEMORY_RUN_ID, workspace.id)).sessionId).toBe('codex-B')
    expect(await service.observe({ ...event, runId: a.OXESPACE_MEMORY_RUN_ID, event: 'session-end' })).toMatchObject({ allowed: true })
    await expect(service.contextForRun(b.OXESPACE_MEMORY_RUN_ID, 'wrong-workspace')).rejects.toThrow()
    await service.stop()
    expect(service.adapters.finalize).toHaveBeenCalledTimes(1)
    expect(service.adapters.finalize).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'claude-A' }), expect.objectContaining({ sessionId: 'claude-A' }))
    expect(service.adapters.finalize).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sessionId: 'codex-B' }))
  }, 15000) // Real Git identity probes plus the bounded native-exit grace period.
  test('disabled, foreign markers and cancelled launches cannot capture', async () => {
    const { workspace, service, root, context } = await fixture()
    const controller = new AbortController()
    controller.abort()
    expect(await service.prepareLaunch({ paneId: workspace.panes[0].id, workspaceId: workspace.id, cwd: root, signal: controller.signal })).toEqual({})
    const env = await service.prepareLaunch({ paneId: workspace.panes[0].id, workspaceId: workspace.id, cwd: root })
    const event = { runId: env.OXESPACE_MEMORY_RUN_ID, sessionId: 'A', agent: 'claude-code', cwd: root, event: 'session-start' }
    await writeFile(join(root, '.ai-memory.toml'), 'workspace = "foreign"\nproject = "foreign"\n')
    expect(await service.observe(event)).toEqual({ allowed: false })
    service.projects.configure(context.projectId, { enabled: false, automaticCapture: true, automaticContext: true })
    expect(await service.observe(event)).toEqual({ allowed: false })
    expect(await service.prepareLaunch({ paneId: workspace.panes[1].id, workspaceId: workspace.id, cwd: root })).toEqual({})
  })
  test('marker updates preserve user capture exclusions', async () => {
    const { service, context, root } = await fixture()
    const settings = { enabled: true, automaticCapture: true, automaticContext: true }
    await service.adapters.marker(context, settings)
    const path = join(root, '.ai-memory.toml')
    const custom = (await readFile(path, 'utf8')) + '\n[capture]\nignore_paths = ["secrets/**"]\n'
    await writeFile(path, custom)
    await service.adapters.marker(context, { ...settings, automaticContext: false })
    expect(await readFile(path, 'utf8')).toBe(custom)
  })
})
