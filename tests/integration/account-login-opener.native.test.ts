// @vitest-environment node
// OXE-361 (review of #1086): the opener the account login gets from the real registerThreadIpc. The guard refuses
// without calling the system; a failure of the system open reaches NativeAccountService, so "Open browser" shows
// accounts.failed and Codex's login ends as 'connection' instead of waiting for its timeout. Temporary folders and
// an in-memory database only; no provider process starts and nothing is opened.
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { removeTempDir } from '../helpers/removeTempDir'

type Opener = (url: string) => Promise<unknown>

const hooks = vi.hoisted(() => ({
  system: vi.fn<(url: string) => Promise<void>>(),
  incident: vi.fn<(...values: unknown[]) => void>(),
  openers: [] as unknown[]
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), handleOnce: vi.fn(), on: vi.fn(), once: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  app: { on: vi.fn(), once: vi.fn(), isPackaged: false, getPath: () => tmpdir(), getVersion: () => '1.6.0', getAppPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class extends EventEmitter {}, clipboard: {}, ClipboardItem: class {}, dialog: {},
  shell: { openExternal: hooks.system },
  safeStorage: { isEncryptionAvailable: () => false }, session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
}))
vi.mock('../../electron/main/services/diagnostics/incident-sink', async importOriginal => ({
  ...(await importOriginal<typeof import('../../electron/main/services/diagnostics/incident-sink')>()),
  recordIncident: hooks.incident
}))
// The real service; only the opener it was given is read.
vi.mock('../../electron/main/services/conversation/native-account.service', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/main/services/conversation/native-account.service')>()
  return {
    ...actual,
    NativeAccountService: class extends actual.NativeAccountService {
      constructor(...args: ConstructorParameters<typeof actual.NativeAccountService>) {
        super(...args)
        hooks.openers.push(args[0].openExternal)
      }
    }
  }
})

const { openInMemoryDatabase } = await import('../../electron/main/db/index')
const { registerThreadIpc } = await import('../../electron/main/ipc/thread.ipc')
const { resetExternalRefusals } = await import('../../electron/main/utils/external-open')

const LOGIN_URL = 'https://auth.example.com/oauth/authorize?client=oxespace'
const cleanups: Array<() => unknown> = []

beforeEach(() => {
  hooks.system.mockReset()
  hooks.incident.mockReset()
  hooks.openers.length = 0
  resetExternalRefusals()
})
afterEach(async () => {
  for (const step of cleanups.splice(0).reverse()) await step()
})

/** The opener NativeAccountService received from the app's own wiring. */
async function accountOpener(): Promise<Opener> {
  const temp = mkdtempSync(join(tmpdir(), 'oxe-account-opener-'))
  cleanups.push(() => removeTempDir(temp))
  const db = openInMemoryDatabase()
  cleanups.push(() => db.close())
  const runtime = registerThreadIpc(db, { bridge: join(temp, 'bridge.cjs'), prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }), end: () => {} })
  cleanups.push(() => runtime.stop())
  await runtime.manager
  expect(hooks.openers).toHaveLength(1)
  return hooks.openers[0] as Opener
}

describe('OXE-361: the opener of the account login', () => {
  test('a rejected system open rejects the opener, and is journalled without the URL', async () => {
    const open = await accountOpener()
    hooks.system.mockRejectedValue(new Error('no handler for https'))
    await expect(open(LOGIN_URL)).rejects.toThrow('no handler for https')
    expect(hooks.system).toHaveBeenCalledWith(LOGIN_URL)
    expect(hooks.incident.mock.calls).toEqual([['incident.window.externalOpenFailed']])
  })

  test('the opener does not resolve before the system open has answered', async () => {
    const open = await accountOpener()
    let answer!: () => void
    hooks.system.mockReturnValue(new Promise<void>(resolve => { answer = resolve }))
    let settled = false
    const opening = open(LOGIN_URL).then(() => { settled = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    answer()
    await opening
    expect(settled).toBe(true)
  })

  test.each([['a file', 'file:///C:/Windows/System32/calc.exe'], ['credentials in the URL', 'https://user:secret@auth.example.com/']])('a refused URL (%s) rejects without calling the system', async (_name, url) => {
    const open = await accountOpener()
    await expect(open(url)).rejects.toThrow('Login browser link unavailable')
    expect(hooks.system).not.toHaveBeenCalled()
    expect(hooks.incident).toHaveBeenCalledWith('incident.window.externalRefused', expect.any(String))
  })

  test('a good URL resolves and records nothing', async () => {
    const open = await accountOpener()
    hooks.system.mockResolvedValue(undefined)
    await expect(open(LOGIN_URL)).resolves.toBeUndefined()
    expect(hooks.system).toHaveBeenCalledTimes(1)
    expect(hooks.incident).not.toHaveBeenCalled()
  })
})
