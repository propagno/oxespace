import { afterEach, describe, expect, test, vi } from 'vitest'

// updater.ts touches electron at module scope (app.isPackaged for the initial
// state), so the module needs a minimal stub to be importable in a unit test.
vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '0.14.2' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined }
}))
vi.mock('electron-log/main.js', () => ({
  default: { info: () => undefined, warn: () => undefined }
}))

const { updaterSupportsThisInstall, isNewerRelease, checkForAppUpdates } = await import('../../electron/main/updater')

afterEach(() => vi.unstubAllGlobals())

describe('published release comparison', () => {
  test('recognizes newer stable versions without treating equal or older releases as updates', () => {
    expect(isNewerRelease('v0.14.3', '0.14.2')).toBe(true)
    expect(isNewerRelease('v0.15.0', '0.14.9')).toBe(true)
    expect(isNewerRelease('v0.14.2', '0.14.2')).toBe(false)
    expect(isNewerRelease('v0.14.1', '0.14.2')).toBe(false)
    expect(isNewerRelease('unknown', '0.14.2')).toBe(false)
  })

  test('dev builds detect updates but offer manual installation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: 'v0.14.3' }) }))
    const result = await checkForAppUpdates(true)
    expect(result.status).toBe('available')
    expect(result.availableVersion).toBe('0.14.3')
    expect(result.installMode).toBe('manual')
  })
})

/**
 * Guards the one behaviour that differs per Linux packaging format. Getting it
 * wrong is not cosmetic: without the guard a .deb install errors on every
 * check and again every six hours, for something the user cannot act on.
 */
describe('updaterSupportsThisInstall', () => {
  test('Windows and macOS always support in-place updates', () => {
    expect(updaterSupportsThisInstall('win32', {})).toBe(true)
    expect(updaterSupportsThisInstall('darwin', {})).toBe(true)
  })

  test('Linux AppImage is supported — $APPIMAGE is set by the bundle at launch', () => {
    expect(updaterSupportsThisInstall('linux', { APPIMAGE: '/tmp/OXESpace-0.6.1-x64.AppImage' })).toBe(true)
  })

  test('Linux without $APPIMAGE (deb/apt-owned install) is not supported', () => {
    expect(updaterSupportsThisInstall('linux', {})).toBe(false)
  })

  test('an empty $APPIMAGE does not count as an AppImage', () => {
    // Guards against `Boolean('')` regressions if the check is ever rewritten
    // as a presence test on the key rather than the value.
    expect(updaterSupportsThisInstall('linux', { APPIMAGE: '' })).toBe(false)
  })
})
