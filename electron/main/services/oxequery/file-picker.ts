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

const EXTENSIONS: Record<string, { name: string; extension: string }> = {
  csv: { name: 'CSV', extension: 'csv' }, json: { name: 'JSON', extension: 'json' }, ndjson: { name: 'Newline-delimited JSON', extension: 'ndjson' }, sql: { name: 'SQL', extension: 'sql' }
}

export type SavePathPicker = (suggestedName: string, format: 'csv' | 'json' | 'ndjson' | 'sql') => Promise<string | null>

/** Native save dialog for an export. The renderer never names the destination. */
export const pickExportPath: SavePathPicker = async (suggestedName, format) => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const kind = EXTENSIONS[format]
  const options = {
    title: 'Export',
    defaultPath: `${suggestedName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'export'}.${kind.extension}`,
    filters: [{ name: kind.name, extensions: [kind.extension] }]
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/** Native chooser for a file to import. Only the path leaves this function, and only to the main process. */
export const pickImportPath = async (): Promise<string | null> => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title: 'Choose a file to import',
    properties: ['openFile' as const],
    filters: [{ name: 'Data files', extensions: ['csv', 'tsv', 'json', 'ndjson', 'jsonl'] }]
  }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
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
