// @vitest-environment node
// Frozen acceptance test for 1.5.2 P0 (Jira OXE-366; A10). Written by the planner; the executor must not edit it.
// src/lib/rendererErrors.ts already sends window.oxe.diagnostics.reportRendererError(input); neither preload nor main
// has it, so every React crash is dropped. Contract:
// - IPC_CHANNELS.diagnostics.reportRendererError = 'diagnostics:report-renderer-error', exposed by the preload;
// - main validates the input (only the fields of RendererErrorInput, names as identifiers, the hash as hex) and records
//   'incident.window.rendererError' in the journal. The message, a path or any other text never reaches the journal.
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => hooks.userData, getVersion: () => '1.5.2', isPackaged: false, getAppMetrics: () => [], once: vi.fn(), on: vi.fn() },
  net: { isOnline: () => true },
  BrowserWindow: { fromWebContents: () => ({}), getAllWindows: () => [] },
  dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true })) },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => hooks.handlers.set(name, handler) }
}))
vi.mock('electron-log/main.js', () => ({ default: { transports: { file: { getFile: () => ({ path: join(hooks.userData, 'logs', 'main.log') }) } } } }))
vi.mock('../../../electron/main/db', () => ({ resolveAppDatabasePath: () => join(hooks.userData, 'oxespace.sqlite3') }))
vi.mock('../../../electron/main/updater', () => ({ getAppUpdateState: () => ({ preferences: { mode: 'auto', channel: 'stable', pinnedVersion: null } }) }))

import { registerDiagnosticsIpc, resetDiagnosticsIpcForTests } from '../../../electron/main/ipc/diagnostics.ipc'
import { createOxeApi } from '../../../electron/preload/api'
import { removeTempDir } from '../../helpers/removeTempDir'

const CHANNEL = 'diagnostics:report-renderer-error'
const REPORT = { kind: 'boundary', boundary: 'root', component: 'WorkspaceGrid', errorName: 'TypeError', stackHash: 'deadbeef' }
const SECRET = 'could not read C:/Users/dana/secrets/.env token=hunter2'

const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame: {}, isDestroyed: () => false, send: () => undefined })
const call = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = hooks.handlers.get(channel)
  expect(handler, `main handles ${channel}`).toBeTypeOf('function')
  return handler!({ sender, senderFrame: sender.mainFrame }, ...args)
}
const incidents = async (): Promise<Array<{ code: string }>> => await call('diagnostics:incidents', {}) as Array<{ code: string }>

beforeEach(() => {
  hooks.userData = mkdtempSync(join(tmpdir(), 'oxe-p0-journal-'))
  registerDiagnosticsIpc({} as never, {} as never, {}, { getSnapshot: () => ({}) } as never)
})
afterEach(() => {
  resetDiagnosticsIpcForTests()
  hooks.handlers.clear()
  if (dirname(resolve(hooks.userData)) !== resolve(tmpdir())) throw Error('Unsafe cleanup')
  removeTempDir(hooks.userData)
})

describe('OXE-366 · React crashes reach the incident journal', () => {
  test('the preload sends a renderer crash to main', async () => {
    const invoke = vi.fn(async () => undefined)
    const api = createOxeApi({ invoke, on: vi.fn(), removeListener: vi.fn(), send: vi.fn() } as never)
    const report = (api.diagnostics as unknown as { reportRendererError?: (input: unknown) => Promise<void> } | undefined)?.reportRendererError
    expect(report, 'window.oxe.diagnostics.reportRendererError exists').toBeTypeOf('function')
    await report!(REPORT)
    expect(invoke).toHaveBeenCalledWith(CHANNEL, REPORT)
  })

  test('main records a renderer crash in the incident journal', async () => {
    await call(CHANNEL, REPORT)
    await vi.waitFor(async () => expect((await incidents()).map(incident => incident.code)).toContain('incident.window.rendererError'))
  })

  test('a report carrying text outside the contract is refused and that text never reaches the journal', async () => {
    for (const bad of [{ ...REPORT, message: SECRET }, { ...REPORT, component: SECRET }, { ...REPORT, stackHash: SECRET }, { ...REPORT, boundary: SECRET }]) {
      await expect(call(CHANNEL, bad)).rejects.toThrow(/^(?!main handles)/)
    }
    expect(JSON.stringify(await incidents())).not.toMatch(/hunter2|dana|rendererError/)
  })
})
