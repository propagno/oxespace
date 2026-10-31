/**
 * `app:open-external` in E2E runs: nothing reaches the system browser. Each request is kept, in order, on
 * `globalThis.__oxeOpenedExternal` in the main process, judged by the real rule, so a spec reads what the window asked
 * to open and what was refused:
 *
 *   await app.evaluate(() => (globalThis as { __oxeOpenedExternal?: { url: unknown; opened: boolean }[] }).__oxeOpenedExternal ?? [])
 */
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { externalUrlRefusal } from '../utils/external-url'

export const E2E_OPENED_EXTERNAL_GLOBAL = '__oxeOpenedExternal'

export interface OpenedExternal { url: unknown; opened: boolean }

/** What the mock answers for one request, recorded on `target` (globalThis by default). */
export function recordOpenExternal(url: unknown, target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): { opened: boolean } {
  const opened = typeof url === 'string' && externalUrlRefusal(url) === null
  const list = (target[E2E_OPENED_EXTERNAL_GLOBAL] ??= []) as OpenedExternal[]
  list.push({ url, opened })
  return { opened }
}

export function registerOpenExternalMock(): void {
  ipcMain.handle(IPC_CHANNELS.app.openExternal, (_event, url: unknown) => recordOpenExternal(url))
}
