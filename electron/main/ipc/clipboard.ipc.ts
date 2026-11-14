import { clipboard, ipcMain } from 'electron'
import { EDIT_COMMANDS, IPC_CHANNELS, type EditCommand } from '../../../shared/types/ipc'

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
  registerEditCommandIpc()
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

/**
 * The Edit menu's commands, run by Chromium on the focused field of the window that asks. A menu item cannot do it
 * from the page: the page's own paste command is not allowed, and the item has the focus while it is chosen. Only the
 * six names of EDIT_COMMANDS; anything else answers false and does nothing.
 */
export function registerEditCommandIpc(): void {
  ipcMain.handle(IPC_CHANNELS.clipboard.edit, (event, command: unknown): boolean => {
    if (!(EDIT_COMMANDS as readonly unknown[]).includes(command)) return false
    event.sender[command as EditCommand]()
    return true
  })
}
