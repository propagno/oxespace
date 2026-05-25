import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { GitService } from '../services/git.service'
import { parseGitBranchInput, parseGitDiffInput } from './validation'

export function registerGitIpc(service = new GitService()): GitService {
  ipcMain.handle(IPC_CHANNELS.git.getBranch, (_event, input: unknown) => {
    const parsed = parseGitBranchInput(input)
    return service.getBranch(parsed.rootPath)
  })

  ipcMain.handle(IPC_CHANNELS.git.getDiff, (event, input: unknown) => {
    const parsed = parseGitDiffInput(input)
    const diff = service.buildDiff(parsed.rootPath, parsed.base, parsed.includeUncommitted)
    service.watchDiff(parsed.rootPath, (updated) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_CHANNELS.git.onDiffUpdate, updated)
      }
    }, parsed.base, parsed.includeUncommitted)
    return diff
  })
  return service
}
