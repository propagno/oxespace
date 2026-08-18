import { describe, expect, test, vi } from 'vitest'

// updater.ts touches electron at module scope (app.isPackaged for the initial
// state), so the module needs a minimal stub to be importable in a unit test.
vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined }
}))
vi.mock('electron-log/main.js', () => ({
  default: { info: () => undefined, warn: () => undefined }
}))

const { updaterSupportsThisInstall } = await import('../../electron/main/updater')

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
