// @vitest-environment node
// Frozen acceptance test for 1.5.2 P0 (Jira OXE-367; A4). Written by the planner; the executor must not edit it.
// Removing a workspace waits until its processes have really ended (terminatePty settles) before its row is deleted.
// An in-memory database, fake PTYs and a held process-tree kill: no process and no folder is touched.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeIpcMain, type FakeIpcMain } from '../../helpers/fake-ipc-main'

const ipcMain: FakeIpcMain = createFakeIpcMain()
const kill = vi.hoisted(() => ({ settle: [] as Array<{ resolve(): void; reject(error: Error): void }> }))
vi.mock('electron', () => ({ ipcMain, BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null }, dialog: { showOpenDialog: vi.fn() } }))
vi.mock('../../../electron/main/utils/process-tree', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  terminatePty: () => new Promise<void>((resolve, reject) => { kill.settle.push({ resolve, reject }) })
}))

const { openInMemoryDatabase } = await import('../../../electron/main/db/index')
const { TerminalManager } = await import('../../../electron/main/services/terminal.service')
const { WorkspaceService } = await import('../../../electron/main/services/workspace.service')
const { registerWorkspaceIpc } = await import('../../../electron/main/ipc/workspace.ipc')

let db: ReturnType<typeof openInMemoryDatabase>
let service: InstanceType<typeof WorkspaceService>
let workspaceId: string
const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

beforeEach(async () => {
  kill.settle = []
  db = openInMemoryDatabase()
  service = new WorkspaceService(db)
  const workspace = service.create({ rootPath: 'C:/p0-fixture', layout: '1x2' })
  workspaceId = workspace.id
  let pid = 0
  const pty = { spawn: () => ({ pid: ++pid, cols: 80, rows: 24, process: 'sh', write() {}, resize() {}, kill() {}, pause() {}, resume() {}, clear() {}, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) }) }
  const manager = new TerminalManager(db, { pty: pty as never })
  for (const pane of workspace.panes) await manager.start({ workspaceId, paneId: pane.id })
  registerWorkspaceIpc(db, manager, { workspaceService: service, shellProfileService: { list: () => [] } as never, agentService: { list: () => [] } as never })
})
afterEach(() => {
  for (const channel of ipcMain.channels()) ipcMain.removeHandler(channel)
  db.close()
})

describe('OXE-367 · removing a workspace with running processes', () => {
  test('the workspace is deleted only after every one of its terminals has ended', async () => {
    const removed = ipcMain.invoke('workspace:delete', workspaceId)
    await pause()
    expect(kill.settle).toHaveLength(2)
    expect(service.get(workspaceId), 'still there while both are ending').not.toBeNull()
    kill.settle[0].resolve()
    await pause()
    expect(service.get(workspaceId), 'still there while one is ending').not.toBeNull()
    kill.settle[1].resolve()
    await removed
    expect(service.get(workspaceId)).toBeNull()
  })

  test('a terminal that cannot be ended keeps the workspace and says so', async () => {
    const removed = ipcMain.invoke('workspace:delete', workspaceId).then(() => 'deleted', () => 'refused')
    await pause()
    expect(service.get(workspaceId), 'still there while they are ending').not.toBeNull()
    kill.settle[0].reject(new Error('taskkill failed'))
    kill.settle[1].resolve()
    expect(await removed).toBe('refused')
    expect(service.get(workspaceId)).not.toBeNull()
  })
})
