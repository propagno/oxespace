import { clipboard, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

/** CRLF and LF read back as the same text: the Windows clipboard may canonicalize line endings. */
export function sameClipboardText(read: string, written: string): boolean {
  const normalize = (input: string): string => input.replace(/\r\n/g, '\n')
  return normalize(read) === normalize(written)
}

/**
 * Clipboard text is read and written in main (Electron's clipboard module needs no renderer permission), so terminal
 * Ctrl+V paste never depends on navigator.clipboard being granted clipboard-read. A write is verified by reading it back.
 */
export function registerClipboardTextIpc(): void {
  ipcMain.handle(IPC_CHANNELS.clipboard.readText, () => clipboard.readText())
  ipcMain.handle(IPC_CHANNELS.clipboard.writeText, async (_e, text: string) => {
    const value = typeof text === 'string' ? text : ''
    try {
      await clipboard.writeText(value)
      return sameClipboardText(await clipboard.readText(), value)
    } catch {
      return false
    }
  })
}
