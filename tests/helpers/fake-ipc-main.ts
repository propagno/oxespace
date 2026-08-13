/**
 * A stand-in for Electron's `ipcMain` that lets a test invoke a channel the way
 * the renderer would.
 *
 * The IPC adapters in `electron/main/ipc/` hold orchestration that exists
 * nowhere else — ordering between a lifecycle controller, the semantic watcher
 * and the service; input validation ahead of the service call; timers. Service
 * tests cannot reach any of it, because they call the service directly and
 * never go through the adapter. Nothing in the suite could construct an
 * `ipcMain`, so that layer had no tests at all; this is the missing piece.
 *
 * Register with `vi.mock('electron', ...)`, then drive the handler:
 *
 *   const ipc = createFakeIpcMain()
 *   vi.mock('electron', () => ({ ipcMain: ipc, BrowserWindow: ..., dialog: ... }))
 *   registerWorkspaceIpc(db, semantic, lifecycle, { workspaceService })
 *   await ipc.invoke('workspace:delete', 'ws-1')
 */

type Handler = (event: unknown, ...args: unknown[]) => unknown

export interface FakeIpcMain {
  handle(channel: string, handler: Handler): void
  removeHandler(channel: string): void
  on(channel: string, handler: Handler): void
  removeAllListeners(channel?: string): void
  /** Channels a `handle` call registered, in registration order. */
  channels(): string[]
  /** Invoke a registered handler the way `ipcRenderer.invoke` would. */
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  /** Fire a listener registered with `on`. */
  emit(channel: string, ...args: unknown[]): void
}

export function createFakeIpcMain(): FakeIpcMain {
  const handlers = new Map<string, Handler>()
  const listeners = new Map<string, Handler[]>()

  return {
    handle(channel, handler) {
      // Mirror Electron: a second handle() on the same channel throws rather
      // than silently replacing the first. A test that registers twice has a
      // bug, and swallowing it here would hide the same bug in production.
      if (handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      handlers.set(channel, handler)
    },
    removeHandler(channel) {
      handlers.delete(channel)
    },
    on(channel, handler) {
      const existing = listeners.get(channel) ?? []
      existing.push(handler)
      listeners.set(channel, existing)
    },
    removeAllListeners(channel) {
      if (channel === undefined) listeners.clear()
      else listeners.delete(channel)
    },
    channels() {
      return [...handlers.keys()]
    },
    async invoke(channel, ...args) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler registered for '${channel}'`)
      // The real invoke path always crosses a promise boundary, so a handler
      // that throws synchronously still surfaces as a rejection to the caller.
      return await handler({ sender: { id: 1 } }, ...args)
    },
    emit(channel, ...args) {
      for (const listener of listeners.get(channel) ?? []) {
        listener({ sender: { id: 1 } }, ...args)
      }
    }
  }
}
