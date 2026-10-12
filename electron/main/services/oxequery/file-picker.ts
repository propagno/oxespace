import { BrowserWindow, dialog } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { PickedKind } from './picked-files'

const MAX_BYTES = 64 * 1024

const TITLES: Record<PickedKind, string> = {
  ca: 'Choose the CA certificate',
  cert: 'Choose the client certificate',
  key: 'Choose the client private key',
  sshKey: 'Choose the SSH private key'
}

export type FilePicker = (kind: PickedKind) => Promise<{ name: string; content: string } | null>

/**
 * Native file chooser for certificates and keys. The renderer asks for a *kind*
 * and never supplies a path; the content is read here and handed to the
 * connection store, not to the page.
 */
export const pickCredentialFile: FilePicker = async kind => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title: TITLES[kind],
    properties: ['openFile' as const],
    filters: kind === 'sshKey'
      ? [{ name: 'Private keys', extensions: ['pem', 'key', 'ppk', ''] }, { name: 'All files', extensions: ['*'] }]
      : [{ name: 'PEM files', extensions: ['pem', 'crt', 'cer', 'key'] }, { name: 'All files', extensions: ['*'] }]
  }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error('That file is too large to be a certificate or key.')
  return { name: basename(path), content: await readFile(path, 'utf8') }
}
