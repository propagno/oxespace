/**
 * The workspace IPC adapter holds orchestration that exists nowhere else: which
 * collaborators run in which order when a workspace or pane goes away, and
 * which mutations are allowed to leave a PTY alive. WorkspaceService knows
 * nothing about the terminal lifecycle or the semantic watcher, so a service
 * test cannot catch a regression here — dropping `lifecycle?.stop()` from
 * setPaneRootPath would leave every service test green while the pane silently
 * kept its old cwd.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeIpcMain, type FakeIpcMain } from '../helpers/fake-ipc-main'
import type { AppDatabase } from '../../electron/main/db'
import type { WorkspaceService } from '../../electron/main/services/workspace.service'
import type { SemanticService } from '../../electron/main/services/semantic.service'

const ipcMain: FakeIpcMain = createFakeIpcMain()
vi.mock('electron', () => ({
  ipcMain,
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() }
}))

const { registerWorkspaceIpc } = await import('../../electron/main/ipc/workspace.ipc')

function setup(): {
  workspaceService: { [K in keyof WorkspaceService]?: ReturnType<typeof vi.fn> }
  semantic: { watchWorkspace: ReturnType<typeof vi.fn>; unwatchWorkspace: ReturnType<typeof vi.fn> }
  lifecycle: { stop: ReturnType<typeof vi.fn>; stopWorkspace: ReturnType<typeof vi.fn> }
  calls: string[]
} {
  // One shared array so assertions can talk about ordering ACROSS
  // collaborators, which is the whole point of testing this layer.
  const calls: string[] = []
  const record = <T>(name: string, result: T) => vi.fn((..._args: unknown[]) => {
    calls.push(name)
    return result
  })

  const workspaceService = {
    delete: record('workspace.delete', undefined),
    closePane: record('workspace.closePane', { id: 'ws-1' }),
    setPaneRootPath: record('workspace.setPaneRootPath', { id: 'pane-1' }),
    createPane: record('workspace.createPane', { id: 'pane-new' }),
    setActive: vi.fn(() => {
      calls.push('workspace.setActive')
      return { id: 'ws-1', rootPath: 'C:/repo' }
    })
  }
  const semantic = {
    watchWorkspace: record('semantic.watchWorkspace', undefined),
    unwatchWorkspace: record('semantic.unwatchWorkspace', undefined)
  }
  const lifecycle = {
    stop: record('lifecycle.stop', undefined),
    stopWorkspace: record('lifecycle.stopWorkspace', undefined)
  }

  registerWorkspaceIpc(
    {} as AppDatabase,
    semantic as unknown as SemanticService,
    lifecycle,
    {
      workspaceService: workspaceService as unknown as WorkspaceService,
      // The adapter builds these two but this suite never exercises their
      // channels; stubbing them keeps the fake database from being touched.
      shellProfileService: { list: vi.fn(() => []) } as never,
      agentService: { list: vi.fn(() => []) } as never
    }
  )

  return { workspaceService, semantic, lifecycle, calls }
}

describe('workspace IPC adapter', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ipcMain.removeAllListeners()
    for (const channel of ipcMain.channels()) ipcMain.removeHandler(channel)
    vi.useRealTimers()
    ctx = setup()
  })

  test('deleting a workspace stops its shells and the watcher before the row goes', async () => {
    await ipcMain.invoke('workspace:delete', 'ws-1')

    // Order matters: deleting the row first would leave stopWorkspace and
    // unwatchWorkspace operating on an id the database no longer resolves.
    expect(ctx.calls).toEqual([
      'lifecycle.stopWorkspace',
      'semantic.unwatchWorkspace',
      'workspace.delete'
    ])
    expect(ctx.lifecycle.stopWorkspace).toHaveBeenCalledWith('ws-1')
    expect(ctx.semantic.unwatchWorkspace).toHaveBeenCalledWith('ws-1')
  })

  test('closing a pane stops its PTY first', async () => {
    await ipcMain.invoke('workspace:close-pane', 'pane-1')

    expect(ctx.calls).toEqual(['lifecycle.stop', 'workspace.closePane'])
    expect(ctx.lifecycle.stop).toHaveBeenCalledWith({ paneId: 'pane-1' })
  })

  test('changing a pane root path stops the pane so the new cwd takes effect', async () => {
    await ipcMain.invoke('workspace:set-pane-root-path', { paneId: 'pane-1', rootPath: 'C:/other' })

    expect(ctx.calls).toEqual(['lifecycle.stop', 'workspace.setPaneRootPath'])
  })

  test('activating a workspace defers the semantic crawl rather than blocking the transition', async () => {
    vi.useFakeTimers()
    await ipcMain.invoke('workspace:set-active', 'ws-1')

    // The crawl fans out thousands of fs-stats; starting it inline is what made
    // workspace switching stutter, so it must NOT have run yet.
    expect(ctx.semantic.watchWorkspace).not.toHaveBeenCalled()

    vi.advanceTimersByTime(750)
    expect(ctx.semantic.watchWorkspace).toHaveBeenCalledWith('ws-1', 'C:/repo')
  })

  test('a workspace with no root path never schedules a watch', async () => {
    vi.useFakeTimers()
    ctx.workspaceService.setActive?.mockReturnValueOnce({ id: 'ws-2', rootPath: null })

    await ipcMain.invoke('workspace:set-active', 'ws-2')
    vi.advanceTimersByTime(5_000)

    expect(ctx.semantic.watchWorkspace).not.toHaveBeenCalled()
  })

  test('invalid input is rejected before the service is reached', async () => {
    await expect(ipcMain.invoke('workspace:create-pane', { workspaceId: '  ' }))
      .rejects.toThrow(/requires a workspaceId string/)
    await expect(ipcMain.invoke('workspace:delete', 42)).rejects.toThrow()

    expect(ctx.calls).toEqual([])
  })

  test('reorder rejects a non-string id instead of persisting a partial list', async () => {
    await expect(ipcMain.invoke('workspace:reorder', ['ws-1', 7])).rejects.toThrow(/ids\[1\]/)
  })
})
