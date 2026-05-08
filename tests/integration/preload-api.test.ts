import { describe, expect, test, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { createOxeApi, type PreloadIpc } from '../../electron/preload/api'

describe('preload api', () => {
  test('exposes workspace and terminal APIs without raw ipc access', async () => {
    const ipc = createFakeIpc()
    const api = createOxeApi(ipc)

    await api.workspace.list()
    await api.workspace.create({ rootPath: 'C:/repo', layout: '1x1' })
    await api.workspace.pickFolder()
    await api.terminal.write({ paneId: 'pane-1', data: 'pwd\r' })

    expect(api).not.toHaveProperty('ipcRenderer')
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.list)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.create, { rootPath: 'C:/repo', layout: '1x1' })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.pickFolder)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.terminal.write, { paneId: 'pane-1', data: 'pwd\r' })
  })

  test('returns unsubscribe functions for terminal listeners', () => {
    const ipc = createFakeIpc()
    const api = createOxeApi(ipc)
    const unsubscribe = api.terminal.onData(() => undefined)

    unsubscribe()

    expect(ipc.on).toHaveBeenCalledWith(IPC_CHANNELS.terminal.onData, expect.any(Function))
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.terminal.onData, expect.any(Function))
  })
})

function createFakeIpc(): PreloadIpc {
  return {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}
