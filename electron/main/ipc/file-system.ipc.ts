import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { FileSystemService } from '../services/file-system.service'
import type { AppDatabase } from '../db/index'
import {
  parseFileSystemListTreeInput,
  parseFileSystemReadFileInput,
  parseFileSystemUnwatchFileInput,
  parseFileSystemWatchFileInput,
  parseFileSystemWriteFileInput
} from './validation'

export function registerFileSystemIpc(db: AppDatabase, fileSystemService = new FileSystemService((workspaceId) => {
  const row = db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(workspaceId) as { root_path: string } | undefined
  return row?.root_path ?? null
})): FileSystemService {
  ipcMain.handle(IPC_CHANNELS.fs.listTree, (_event, input: unknown) => fileSystemService.listTree(parseFileSystemListTreeInput(input)))
  ipcMain.handle(IPC_CHANNELS.fs.readFile, (_event, input: unknown) => fileSystemService.readFile(parseFileSystemReadFileInput(input)))
  ipcMain.handle(IPC_CHANNELS.fs.writeFile, (_event, input: unknown) => fileSystemService.writeFile(parseFileSystemWriteFileInput(input)))
  ipcMain.handle(IPC_CHANNELS.fs.watchFile, (event, input: unknown) =>
    fileSystemService.watchFile(parseFileSystemWatchFileInput(input), (payload) => {
      event.sender.send(IPC_CHANNELS.fs.onFileChanged, payload)
    })
  )
  ipcMain.handle(IPC_CHANNELS.fs.unwatchFile, (_event, input: unknown) => {
    fileSystemService.unwatchFile(parseFileSystemUnwatchFileInput(input).watchId)
  })

  return fileSystemService
}
