import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { FileSystemService } from '../services/file-system.service'
import {
  parseFileSystemListTreeInput,
  parseFileSystemReadFileInput,
  parseFileSystemUnwatchFileInput,
  parseFileSystemWatchFileInput,
  parseFileSystemWriteFileInput
} from './validation'

export function registerFileSystemIpc(fileSystemService = new FileSystemService()): FileSystemService {
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
