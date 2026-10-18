import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { GitService } from '../services/git.service'
import { parseGitBranchInput, parseGitDiffInput, parseGitFileAtRefInput, parseGitFileOriginalInput } from './validation'

export function registerGitIpc(service = new GitService()): GitService {
  ipcMain.handle(IPC_CHANNELS.git.getBranch, (_event, input: unknown) => {
    const parsed = parseGitBranchInput(input)
    return service.getBranch(parsed.rootPath)
  })

  ipcMain.handle(IPC_CHANNELS.git.getStatus, (_event, input: unknown) => {
    const parsed = parseGitBranchInput(input)
    return service.getStatus(parsed.rootPath)
  })

  ipcMain.handle(IPC_CHANNELS.git.getDiff, (event, input: unknown) => {
    const parsed = parseGitDiffInput(input)
    const diff = service.buildDiff(parsed.rootPath, parsed.base, parsed.includeUncommitted, parsed.head, parsed.mode)
    // Two refs do not change when the index does, so only a work-tree side is watched.
    if (parsed.head) return diff
    service.watchDiff(parsed.rootPath, (updated) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_CHANNELS.git.onDiffUpdate, updated)
      }
    }, parsed.base, parsed.includeUncommitted)
    return diff
  })

  ipcMain.handle(IPC_CHANNELS.git.getDiffSummary, (_event, input: unknown) => {
    const parsed = parseGitDiffInput(input)
    return service.getDiffSummary(parsed.rootPath, parsed.base, parsed.includeUncommitted, parsed.head, parsed.mode)
  })

  ipcMain.handle(IPC_CHANNELS.git.getFileOriginal, (_event, input: unknown) => {
    const parsed = parseGitFileOriginalInput(input)
    return service.getFileOriginal(parsed.rootPath, parsed.base, parsed.path, parsed.oldPath, parsed.head, parsed.mode)
  })

  ipcMain.handle(IPC_CHANNELS.git.getFileAtRef, (_event, input: unknown) => {
    const parsed = parseGitFileAtRefInput(input)
    return service.getFileAtRef(parsed.rootPath, parsed.ref, parsed.path)
  })
  return service
}
