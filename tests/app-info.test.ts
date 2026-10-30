import { afterEach, describe, expect, it, vi } from 'vitest'
import { aboutFacts, appChannel, connectivityOf, ConnectivityWatcher } from '../electron/main/services/app-info'
import { sameClipboardText } from '../electron/main/ipc/clipboard.ipc'

vi.mock('electron', () => ({ clipboard: {}, ipcMain: { handle: vi.fn() } }))

afterEach(() => { vi.useRealTimers() })

describe('About facts', () => {
  const source = { version: '1.4.0', packaged: true, versions: { electron: '39.0.0', chrome: '142.0', node: '22.20.0', v8: '14.2' }, platform: 'win32' as const, arch: 'x64', osRelease: '10.0.26200' }

  it('names the channel from how the app runs and its version', () => {
    expect(appChannel('1.4.0', false)).toBe('dev')
    expect(appChannel('1.4.0', true)).toBe('stable')
    expect(appChannel('1.4.0-beta.2', true)).toBe('beta')
    expect(appChannel('1.4.0-rc.1', true)).toBe('beta')
    expect(appChannel('1.4.0-alpha', true)).toBe('beta')
  })

  it('reports version, build and runtime, and keeps only a well-formed commit and date', () => {
    expect(aboutFacts({ ...source, commit: 'ABCDEF0123456789abcdef0123456789abcdef01', builtAt: '2026-10-30T12:00:00Z' })).toEqual({
      name: 'OXESpace', version: '1.4.0', channel: 'stable', commit: 'ABCDEF012345', builtAt: '2026-10-30T12:00:00.000Z',
      versions: { electron: '39.0.0', chrome: '142.0', node: '22.20.0', v8: '14.2' }, platform: 'win32', arch: 'x64', osRelease: '10.0.26200',
      license: 'MIT', repositoryUrl: 'https://github.com/propagno/oxespace'
    })
    for (const commit of ['', 'not-a-sha', 'abc', '<script>', 'g'.repeat(40)]) expect(aboutFacts({ ...source, commit }).commit, commit).toBeNull()
    for (const builtAt of ['', 'yesterday', 'C:/Users/me']) expect(aboutFacts({ ...source, builtAt }).builtAt, builtAt).toBeNull()
    expect(aboutFacts({ ...source, versions: {} }).versions).toEqual({ electron: '', chrome: '', node: '', v8: '' })
  })

  it('carries no path, account or host name', () => {
    const text = JSON.stringify(aboutFacts(source))
    expect(text).not.toMatch(/Users|home|AppData|userData|hostname/i)
  })
})

describe('connectivity', () => {
  it('says why it is offline with a message code, and unknown when the system cannot tell', () => {
    expect(connectivityOf(true, 5)).toEqual({ state: 'online', checkedAt: 5 })
    expect(connectivityOf(false, 5)).toEqual({ state: 'offline', checkedAt: 5, reason: { code: 'app.connectivity.offline', params: {} } })
    expect(connectivityOf(undefined, 5)).toEqual({ state: 'unknown', checkedAt: 5 })
  })

  it('starts watching on the first read and tells listeners only when the state changes', () => {
    vi.useFakeTimers()
    let online = true
    const publish = vi.fn()
    const watcher = new ConnectivityWatcher(() => online, publish, 1000, () => 7)
    vi.advanceTimersByTime(5000)
    expect(publish).not.toHaveBeenCalled()
    expect(watcher.read()).toEqual({ state: 'online', checkedAt: 7 })
    vi.advanceTimersByTime(3000)
    expect(publish).not.toHaveBeenCalled()
    online = false
    vi.advanceTimersByTime(1000)
    expect(publish).toHaveBeenCalledExactlyOnceWith({ state: 'offline', checkedAt: 7, reason: { code: 'app.connectivity.offline', params: {} } })
    vi.advanceTimersByTime(5000)
    expect(publish).toHaveBeenCalledOnce()
    online = true
    vi.advanceTimersByTime(1000)
    expect(publish).toHaveBeenLastCalledWith({ state: 'online', checkedAt: 7 })
    watcher.stop()
    online = false
    vi.advanceTimersByTime(5000)
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('reads unknown when the system check throws', () => {
    const watcher = new ConnectivityWatcher(() => { throw new Error('no net module') }, vi.fn(), 1000, () => 1)
    expect(watcher.read().state).toBe('unknown')
    watcher.stop()
  })
})

describe('clipboard text', () => {
  it('treats CRLF and LF as the same text and anything else as different', () => {
    expect(sameClipboardText('a\r\nb', 'a\nb')).toBe(true)
    expect(sameClipboardText('a\nb', 'a\nb')).toBe(true)
    expect(sameClipboardText('a\nb', 'a b')).toBe(false)
  })
})
