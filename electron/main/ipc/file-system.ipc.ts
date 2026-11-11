import { ipcMain } from 'electron'
import { resolve } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { FileSystemService } from '../services/file-system.service'
import { sameRepository } from '../services/git-common-dir'
import type { AppDatabase } from '../db/index'
import {
  parseFileSystemListTreeInput,
  parseFileSystemReadFileInput,
  parseFileSystemUnwatchFileInput,
  parseFileSystemWatchFileInput,
} from './validation'

/**
 * The root main has registered for a workspace id (or `thread:<projectId>`), or null. The file system channels and
 * "Abrir em…" (B18) authorize a window's path by it.
 */
export function workspaceRootResolver(db: AppDatabase): (workspaceId: string, requestedRoot: string) => string | null {
  return (workspaceId, requestedRoot) => {
    if (workspaceId.startsWith('thread:')) {
      const row = db.prepare('SELECT root_path FROM thread_project_contexts WHERE project_id = ? AND root_path = ?').get(workspaceId.slice('thread:'.length), requestedRoot) as { root_path: string } | undefined
      return row?.root_path ?? null
    }
    const row = db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(workspaceId) as { root_path: string } | undefined
    return row ? worktreeOrWorkspaceRoot(row.root_path, requestedRoot) : null
  }
}

export function registerFileSystemIpc(db: AppDatabase, fileSystemService = new FileSystemService(workspaceRootResolver(db))): FileSystemService {
  ipcMain.handle(IPC_CHANNELS.fs.listTree, (_event, input: unknown) => fileSystemService.listTree(parseFileSystemListTreeInput(input)))
  ipcMain.handle(IPC_CHANNELS.fs.readFile, (_event, input: unknown) => fileSystemService.readFile(parseFileSystemReadFileInput(input)))
  // Rich previews (#10): same validated shape as readFile, base64 payload out.
  ipcMain.handle(IPC_CHANNELS.fs.readBinary, (_event, input: unknown) => fileSystemService.readBinary(parseFileSystemReadFileInput(input)))
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

/**
 * A pane or the Changes panel may work in another checkout of the workspace's repository (a linked worktree).
 * That checkout is authorized as its own root; any other directory still resolves to the workspace root,
 * so the service's root comparison rejects it.
 */
export function worktreeOrWorkspaceRoot(workspaceRoot: string, requestedRoot: string): string {
  // A requested root on a network share or a device path is never looked at (SECURITY #510 L).
  if (!requestedRoot || /^[\\/]{2}/.test(requestedRoot) || resolve(requestedRoot) === resolve(workspaceRoot)) return workspaceRoot
  return sameRepository(workspaceRoot, requestedRoot) ? requestedRoot : workspaceRoot
}
