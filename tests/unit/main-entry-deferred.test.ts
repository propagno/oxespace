import { beforeEach, describe, expect, it, vi } from 'vitest'

// T44: modules boot does not call load behind `await import()`. Each deferred path works on its first call and, when
// its import fails, fails closed: the call that asked is refused and nothing half-starts.

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) } } }))

const { IPC_CHANNELS } = await import('../../shared/types/ipc')
const { registerAppUpdateIpc, startAutoUpdater } = await import('../../electron/main/ipc/app-update.ipc')

type Updater = typeof import('../../electron/main/updater')

function fakeUpdater(): Updater {
  return {
    getAppUpdateState: vi.fn(() => ({ status: 'idle' })),
    checkForAppUpdates: vi.fn(async (manual: boolean) => ({ status: manual ? 'checking' : 'idle' })),
    quitAndInstallUpdate: vi.fn(() => true),
    downloadAppUpdate: vi.fn(async () => ({ status: 'downloading' })),
    setUpdatePreferences: vi.fn((value: unknown) => ({ status: 'idle', preferences: value })),
    initAutoUpdater: vi.fn()
  } as unknown as Updater
}

describe('T44 · the updater loads on its first request', () => {
  beforeEach(() => handlers.clear())

  it('every update channel registers at boot without loading the updater', () => {
    const load = vi.fn(async () => fakeUpdater())
    registerAppUpdateIpc(load)
    expect([...handlers.keys()].sort()).toEqual([
      IPC_CHANNELS.app.getUpdateState, IPC_CHANNELS.app.checkForUpdates, IPC_CHANNELS.app.quitAndInstall,
      IPC_CHANNELS.app.downloadUpdate, IPC_CHANNELS.app.setUpdatePreferences
    ].sort())
    expect(load).not.toHaveBeenCalled()
  })

  it('the first call loads it and answers as before', async () => {
    const updater = fakeUpdater()
    registerAppUpdateIpc(async () => updater)
    expect(await handlers.get(IPC_CHANNELS.app.getUpdateState)!({})).toEqual({ status: 'idle' })
    expect(await handlers.get(IPC_CHANNELS.app.checkForUpdates)!({})).toEqual({ status: 'checking' })
    expect(await handlers.get(IPC_CHANNELS.app.quitAndInstall)!({})).toBe(true)
    expect(await handlers.get(IPC_CHANNELS.app.downloadUpdate)!({})).toEqual({ status: 'downloading' })
    expect(await handlers.get(IPC_CHANNELS.app.setUpdatePreferences)!({}, { mode: 'manual' })).toEqual({ status: 'idle', preferences: { mode: 'manual' } })
    expect(updater.checkForAppUpdates).toHaveBeenCalledWith(true)
  })

  it('an updater that cannot load refuses the call, installs nothing, and the next call tries again', async () => {
    const updater = fakeUpdater()
    const load = vi.fn<() => Promise<Updater>>().mockRejectedValueOnce(new Error('chunk missing')).mockResolvedValue(updater)
    registerAppUpdateIpc(load)
    await expect(handlers.get(IPC_CHANNELS.app.quitAndInstall)!({})).rejects.toThrow('chunk missing')
    expect(updater.quitAndInstallUpdate).not.toHaveBeenCalled()
    expect(await handlers.get(IPC_CHANNELS.app.getUpdateState)!({})).toEqual({ status: 'idle' })
  })

  it('the periodic checks start after the first window; a failed load only warns and leaves them off', async () => {
    const updater = fakeUpdater()
    await startAutoUpdater(async () => updater)
    expect(updater.initAutoUpdater).toHaveBeenCalledTimes(1)
    const warn = vi.fn()
    await expect(startAutoUpdater(async () => { throw new Error('chunk missing') }, warn)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('chunk missing')
  })
})
