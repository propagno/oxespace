import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { GitService } from '../services/git.service'
import { createChangedFilesCounter } from '../services/git/changed-files-count'
import { parseGitBranchInput, parseGitDiffInput, parseGitFileAtRefInput, parseGitFileOriginalInput } from './validation'

const CHANGED_COUNT_DEBOUNCE_MS = 500

export function parseChangedCountInput(value: unknown): { rootPath: string } {
  const rootPath = value && typeof value === 'object' ? (value as { rootPath?: unknown }).rootPath : undefined
  if (typeof rootPath !== 'string' || rootPath.trim() === '' || rootPath.length > 4096 || rootPath.includes('\0')) {
    throw new Error('git.changedCount needs a rootPath')
  }
  return { rootPath }
}

/** OXE-185: a git status that reports an error is a failed read (null), never 0 changed files. */
export function changedFilesCounterFor(service: Pick<GitService, 'getStatus'>) {
  return createChangedFilesCounter({
    debounceMs: CHANGED_COUNT_DEBOUNCE_MS,
    read: async (rootPath) => {
      const status = await service.getStatus(rootPath)
      if (status.error) throw new Error(status.error)
      return status
    }
  })
}

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
        // Every window hears every watcher: the payload says which root it was computed for.
        win.webContents.send(IPC_CHANNELS.git.onDiffUpdate, { ...updated, rootPath: parsed.rootPath })
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

  const changedFiles = changedFilesCounterFor(service)
  ipcMain.handle(IPC_CHANNELS.git.changedCount, (_event, input: unknown) => {
    const parsed = parseChangedCountInput(input)
    return changedFiles.count(parsed.rootPath)
  })
  return service
}
