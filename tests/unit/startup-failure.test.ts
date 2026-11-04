import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { quit: vi.fn(), relaunch: vi.fn() }, ipcMain: { handle: vi.fn() }, shell: { openPath: vi.fn(async () => '') } }))

describe('T87 startup failure', () => {
  it('names each kind of failure from what better-sqlite3 or the migration runner threw', async () => {
    const { startupFailureCode } = await import('../../electron/main/startup-failure')
    const newer = Object.assign(new Error('This database was created by a newer OXESpace version. Open it with that version; downgrade migration is not supported.'), { newerSchema: true })
    expect(startupFailureCode(newer)).toBe('newer-schema')
    expect(startupFailureCode(new Error('This database was created by a newer OXESpace version.'))).toBe('newer-schema')
    expect(startupFailureCode(Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' }))).toBe('corrupt')
    expect(startupFailureCode(Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' }))).toBe('corrupt')
    expect(startupFailureCode(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }))).toBe('locked')
    expect(startupFailureCode(new Error('The module was compiled against a different Node.js version'))).toBe('other')
    expect(startupFailureCode('just text')).toBe('other')
  })

  it('records the message (clipped) and the backups folder next to the database', async () => {
    const { describeStartupFailure } = await import('../../electron/main/startup-failure')
    const db = join('profile', 'oxespace.sqlite3')
    const failure = describeStartupFailure(new Error('x'.repeat(3_000)), db)
    expect(failure).toMatchObject({ code: 'other', backupsPath: join('profile', 'db-backups'), databasePath: db })
    expect(failure.message.length).toBeLessThanOrEqual(2_001)
  })

  it('registers only the startup-failure channels after a failure, and only the null answer otherwise', async () => {
    const electron = await import('electron')
    const { registerStartupFailureIpc } = await import('../../electron/main/startup-failure')
    const handle = vi.mocked(electron.ipcMain.handle)
    handle.mockClear()
    registerStartupFailureIpc(null)
    expect(handle.mock.calls.map(call => call[0])).toEqual(['app:startup-failure'])
    handle.mockClear()
    const failure = { code: 'newer-schema' as const, message: 'm', backupsPath: join('p', 'db-backups'), databasePath: join('p', 'oxespace.sqlite3') }
    registerStartupFailureIpc(failure)
    expect(handle.mock.calls.map(call => call[0])).toEqual(['app:startup-failure', 'app:open-backups-folder', 'app:quit-after-startup-failure', 'app:relaunch-after-startup-failure'])
    const answer = handle.mock.calls[0][1] as () => unknown
    expect(answer()).toEqual(failure)
    // The folder is main's own; when there is no backups folder yet, the data folder opens instead.
    vi.mocked(electron.shell.openPath).mockResolvedValueOnce('not found')
    await (handle.mock.calls[1][1] as () => Promise<void>)()
    expect(vi.mocked(electron.shell.openPath).mock.calls.map(call => call[0])).toEqual([failure.backupsPath, 'p'])
    // Try again (a locked database): relaunch, then quit this instance.
    await (handle.mock.calls[3][1] as () => void)()
    expect(vi.mocked(electron.app.relaunch)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(electron.app.quit)).toHaveBeenCalledTimes(1)
  })
})
