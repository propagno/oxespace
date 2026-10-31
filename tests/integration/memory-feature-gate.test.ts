import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { MemoryService } from '../../electron/main/services/memory/memory.service'
import { TOOL_REGISTRY, activeTools, findTool, gateMemoryTools } from '../../electron/main/mcp-internal/tool-registry'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) } },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(text), decryptString: (value: Buffer) => value.toString() }
}))
const cleanup: { service: MemoryService; db: AppDatabase; directory: string }[] = []
afterEach(async () => {
  gateMemoryTools(() => true)
  handlers.clear()
  for (const entry of cleanup.splice(0)) { await entry.service.stop(); entry.db.close(); await rm(entry.directory, { recursive: true, force: true }) }
})
async function fixture(featureEnabled: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'oxespace-memory-gate-'))
  const root = join(directory, 'project')
  await mkdir(root)
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db).create({ rootPath: root, layout: '1x2', autoStart: false })
  db.prepare('INSERT INTO internal_mcp_meta (id, port, token, generated_at) VALUES (?, ?, ?, ?)').run('singleton', 12345, 'synthetic', Date.now())
  const service = new MemoryService(db, join(directory, 'memory'), () => featureEnabled)
  cleanup.push({ service, db, directory })
  const context = await service.projects.workspace(workspace.id)
  // A project that already opted in under an earlier build keeps its stored choice.
  service.projects.configure(context.projectId, { enabled: true, automaticCapture: true, automaticContext: true })
  return { db, directory, root, workspace, service, context }
}

describe('Shared Project Memory feature gate', () => {
  test('off: the app opens a database that already has memory data and reports nothing available', async () => {
    const { db, workspace, service, context } = await fixture(false)
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'memory_projects'").get()).toMatchObject({ n: 1 })
    expect(service.projects.settings(context.projectId)).toEqual({ enabled: true, automaticCapture: true, automaticContext: true })
    const status = await service.status(workspace.id)
    expect(status).toMatchObject({ featureEnabled: false, health: { status: 'disabled' }, settings: { enabled: false, automaticCapture: false, automaticContext: false }, sessions: [] })
    expect(service.effectiveSettings(context.projectId)).toEqual({ enabled: false, automaticCapture: false, automaticContext: false })
  })

  test('off: no service start, no launch environment, no thread capture, no provider call', async () => {
    const { workspace, service, root } = await fixture(false)
    const start = vi.spyOn(service.runtime, 'start').mockResolvedValue()
    await service.init()
    expect(start).not.toHaveBeenCalled()
    expect(await service.prepareLaunch({ paneId: 'pane-1', workspaceId: workspace.id, cwd: root, captureOwner: 'native' })).toEqual({})
    expect(await service.prepareLaunch({ paneId: 'thread:t', workspaceId: workspace.id, cwd: root, captureOwner: 'external', expectedAgent: 'codex' })).toEqual({})
    expect(() => service.observeThread({ thread: { id: 't' }, turns: [], events: [] } as never, { type: 'completed', status: 'completed' } as never)).not.toThrow()
    const context = await service.projects.workspace(workspace.id)
    const operation = vi.fn()
    expect((await service.manager.run(context, operation as never)).status).toBe('disabled')
    expect(operation).not.toHaveBeenCalled()
  })

  test('on: behaviour is unchanged', async () => {
    const { workspace, service, root, context } = await fixture(true)
    expect((await service.status(workspace.id)).featureEnabled).toBeUndefined()
    expect(service.effectiveSettings(context.projectId)).toEqual({ enabled: true, automaticCapture: true, automaticContext: true })
    expect(await service.prepareLaunch({ paneId: 'pane-2', workspaceId: workspace.id, cwd: root, captureOwner: 'native' })).toHaveProperty('OXESPACE_MEMORY_RUN')
  })

  test('off: oxespace_memory_* tools are not listed or callable; code context stays', () => {
    gateMemoryTools(() => false)
    const names = activeTools().map(entry => entry.descriptor.name)
    expect(names.some(name => name.startsWith('oxespace_memory_'))).toBe(false)
    expect(names).toContain('oxespace_project_context')
    expect(findTool('oxespace_memory_search')).toBeNull()
    expect(findTool('oxespace_delegation_status')).not.toBeNull()
    gateMemoryTools(() => true)
    expect(activeTools()).toHaveLength(TOOL_REGISTRY.length)
    expect(findTool('oxespace_memory_search')).not.toBeNull()
  })

  test('off: only status is served over IPC, and it says the feature is unavailable', async () => {
    const { registerMemoryIpc } = await import('../../electron/main/ipc/memory.ipc')
    const { workspace, service } = await fixture(false)
    registerMemoryIpc(service)
    const status = await handlers.get('memory:status')!({}, workspace.id) as { featureEnabled: boolean }
    expect(status.featureEnabled).toBe(false)
    for (const channel of ['memory:recent', 'memory:handoffs', 'memory:storage', 'memory:install', 'memory:rollback', 'memory:setup-agents', 'memory:search', 'memory:configure', 'memory:accept-handoff']) {
      expect(() => handlers.get(channel)!({}, workspace.id)).toThrow('not enabled')
    }
  })
})
