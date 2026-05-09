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
    await api.workspace.updatePaneType({ paneId: 'pane-1', type: 'editor' })
    await api.workspace.updateEditorState({ workspaceId: 'workspace-1', editorVisible: true, editorWidthPercent: 40 })
    await api.workspace.updateSettings({ workspaceId: 'workspace-1', themeId: 'nord', layoutPreset: 6 })
    await api.terminal.write({ paneId: 'pane-1', data: 'pwd\r' })
    await api.tasks.list('workspace-1')
    await api.tasks.create({ workspaceId: 'workspace-1', title: 'Task' })
    await api.fs.listTree({ workspaceId: 'workspace-1', rootPath: 'C:/repo' })
    await api.fs.readFile({ workspaceId: 'workspace-1', rootPath: 'C:/repo', relativePath: 'README.md' })
    await api.fs.writeFile({ workspaceId: 'workspace-1', rootPath: 'C:/repo', relativePath: 'README.md', content: 'ok' })
    await api.fs.watchFile({ workspaceId: 'workspace-1', rootPath: 'C:/repo', relativePath: 'README.md' })
    await api.fs.unwatchFile({ watchId: 'watch-1' })

    expect(api).not.toHaveProperty('ipcRenderer')
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.list)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.create, { rootPath: 'C:/repo', layout: '1x1' })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.pickFolder)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.updatePaneType, { paneId: 'pane-1', type: 'editor' })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.updateEditorState, { workspaceId: 'workspace-1', editorVisible: true, editorWidthPercent: 40 })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.updateSettings, { workspaceId: 'workspace-1', themeId: 'nord', layoutPreset: 6 })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.terminal.write, { paneId: 'pane-1', data: 'pwd\r' })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.tasks.list, 'workspace-1')
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.tasks.create, { workspaceId: 'workspace-1', title: 'Task' })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.fs.listTree, { workspaceId: 'workspace-1', rootPath: 'C:/repo' })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.fs.readFile, { workspaceId: 'workspace-1', rootPath: 'C:/repo', relativePath: 'README.md' })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.fs.writeFile, {
      workspaceId: 'workspace-1',
      rootPath: 'C:/repo',
      relativePath: 'README.md',
      content: 'ok'
    })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.fs.watchFile, { workspaceId: 'workspace-1', rootPath: 'C:/repo', relativePath: 'README.md' })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.fs.unwatchFile, { watchId: 'watch-1' })
  })

  test('returns unsubscribe functions for terminal and task listeners', () => {
    const ipc = createFakeIpc()
    const api = createOxeApi(ipc)
    const unsubscribe = api.terminal.onData(() => undefined)
    const unsubscribeTask = api.tasks.onVerifyOutput(() => undefined)
    const unsubscribeFs = api.fs.onFileChanged(() => undefined)

    unsubscribe()
    unsubscribeTask()
    unsubscribeFs()

    expect(ipc.on).toHaveBeenCalledWith(IPC_CHANNELS.terminal.onData, expect.any(Function))
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.terminal.onData, expect.any(Function))
    expect(ipc.on).toHaveBeenCalledWith(IPC_CHANNELS.tasks.onVerifyOutput, expect.any(Function))
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.tasks.onVerifyOutput, expect.any(Function))
    expect(ipc.on).toHaveBeenCalledWith(IPC_CHANNELS.fs.onFileChanged, expect.any(Function))
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.fs.onFileChanged, expect.any(Function))
  })
})

function createFakeIpc(): PreloadIpc {
  return {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}
