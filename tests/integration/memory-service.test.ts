import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { MemoryService } from '../../electron/main/services/memory/memory.service'

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
  test('independent runs keep native sessions and closing one cannot close the other', async () => {
    const { workspace, service, root } = await fixture()
    const [a, b] = await Promise.all(workspace.panes.map(pane => service.prepareLaunch({ paneId: pane.id, workspaceId: workspace.id, cwd: root })))
    expect(a.OXESPACE_MEMORY_RUN_ID).not.toBe(b.OXESPACE_MEMORY_RUN_ID)
    const event = { sessionId: 'claude-A', agent: 'claude-code', cwd: root, event: 'session-start' }
    expect(await service.observe({ ...event, runId: a.OXESPACE_MEMORY_RUN_ID })).toMatchObject({ allowed: true, capture: true, context: false })
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
    expect(service.adapters.finalize).toHaveBeenCalledTimes(2)
    expect(service.adapters.finalize).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'claude-A' }), expect.objectContaining({ sessionId: 'claude-A' }))
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
