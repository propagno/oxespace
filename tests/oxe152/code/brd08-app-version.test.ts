// Frozen acceptance test for 1.5.2 OxeCode A6 (OXE program oxespace-152-code, phase F2, Jira OXE-71, BRD-08).
// Written by the planner; the executor must not edit it.
// Defect: unpackaged, Electron's app.getVersion() reports Electron's own version (44.x), not the app's. The app's
// version is APP_VERSION (electron/main/services/app-info.ts, from package.json). The update state that About and
// Settings read (updater.ts currentVersion), the runtime diagnostics (index.ts startRuntimeDiagnostics) and the local RPC
// bus (index.ts startRpcServer appVersion) still use app.getVersion(). Contract: they all use APP_VERSION.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '44.10.0', getPath: () => '/user-data' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined }
}))
vi.mock('electron-log/main.js', () => ({ default: { info: () => undefined, warn: () => undefined } }))

const { APP_VERSION } = await import('../../../electron/main/services/app-info')
const { getAppUpdateState } = await import('../../../electron/main/updater')

describe("A6 · the app's own version everywhere, never Electron's (OXE-71, BRD-08)", () => {
  test('the update state reports the app version, not Electron\'s', () => {
    expect(APP_VERSION).not.toBe('44.10.0')
    expect(getAppUpdateState().currentVersion).toBe(APP_VERSION)
  })

  test('main hands the app version to the runtime diagnostics and the RPC bus', () => {
    // rigor: source-assertion — index.ts boots the whole main process; these two calls are wiring, and the value they
    // must carry is proven above.
    const index = readFileSync(join(process.cwd(), 'electron/main/index.ts'), 'utf8')
    expect(index).not.toMatch(/startRuntimeDiagnostics\([^)]*app\.getVersion\(\)/)
    expect(index).not.toMatch(/appVersion:\s*app\.getVersion\(\)/)
    expect(index).toMatch(/startRuntimeDiagnostics\([^)]*APP_VERSION/)
  })
})
