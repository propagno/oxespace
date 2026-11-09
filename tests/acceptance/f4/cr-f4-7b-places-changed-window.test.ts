// @vitest-environment node
/**
 * Frozen acceptance test for CR-F4-7b (TECH LEAD 09/11, OXE program phase F4): main forwards each places change to the
 * window as thread:places-changed with { threadId } only. forwardPlacesChanged({ manager }) (electron/main/ipc/
 * thread-places-changed.ts) subscribes once to ThreadManager.subscribePlaces('*', …), the emitter frozen through the real
 * manager in cr-f4-7b-places-changed.native.test.ts, and sends to every live window. registerThreadIpc calls it.
 * Written by the planner; the executor must not edit it.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ windows: [] as unknown[] }))
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  app: { on: vi.fn(), once: vi.fn(), isPackaged: true, getPath: () => '', getVersion: () => '1.5.0', getAppPath: () => '' },
  BrowserWindow: { getAllWindows: () => hooks.windows, fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {}, clipboard: {}, ClipboardItem: class {}, dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false },
  session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
}))

const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
const { forwardPlacesChanged } = await import('../../../electron/main/ipc/thread-places-changed')
const ROOT = resolve(__dirname, '../../..')

function window(destroyed = false) {
  return { isDestroyed: () => destroyed, webContents: { isDestroyed: () => destroyed, send: vi.fn() } }
}
/** Waits a few ticks for the lazy manager promise, never a fixed sleep. */
async function until(condition: () => boolean): Promise<void> {
  for (let tick = 0; tick < 50 && !condition(); tick++) await new Promise(resolve => setImmediate(resolve))
  expect(condition()).toBe(true)
}

describe('CR-F4-7b · places-changed to the window', () => {
  test('CR-F4-7b: main subscribes once to every conversation and sends thread:places-changed with { threadId } only to each live window', async () => {
    const unsubscribe = vi.fn()
    const subscribePlaces = vi.fn((_id: string, _listener: (threadId: string) => void) => unsubscribe)
    forwardPlacesChanged({ manager: Promise.resolve({ subscribePlaces } as never) })
    await until(() => subscribePlaces.mock.calls.length > 0)
    expect(subscribePlaces).toHaveBeenCalledTimes(1)
    const [scope, listener] = subscribePlaces.mock.calls[0]
    expect(scope).toBe('*')

    const live = [window(), window()], gone = window(true)
    hooks.windows = [...live, gone]
    try {
      listener('thread-A')
      for (const target of live) {
        expect(target.webContents.send).toHaveBeenCalledTimes(1)
        const [channel, payload] = target.webContents.send.mock.calls[0]
        expect(channel).toBe(IPC_CHANNELS.thread.placesChanged)
        expect(channel).toBe('thread:places-changed')
        expect(payload).toEqual({ threadId: 'thread-A' })
        expect(Object.keys(payload as object)).toEqual(['threadId'])
      }
      expect(gone.webContents.send).not.toHaveBeenCalled()
      // With no window open, a change is dropped without an error.
      hooks.windows = []
      expect(() => listener('thread-B')).not.toThrow()
    } finally { hooks.windows = [] }
  })

  test('CR-F4-7b: the app forwards places changes from the conversation channels (marked source check: registerThreadIpc needs the database)', () => {
    // Source text on purpose, as in CR-F4-7: registerThreadIpc opens services over the app database.
    const source = readFileSync(join(ROOT, 'electron', 'main', 'ipc', 'thread.ipc.ts'), 'utf8')
    expect(source).toMatch(/import \{[^}]*\bforwardPlacesChanged\b[^}]*\} from '\.\/thread-places-changed'/)
    expect(source).toMatch(/forwardPlacesChanged\(\{ manager[,\s}]/)
  })
})
