import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ThreadWorktreeChoice, ThreadWorktreeFinishResult } from '../../../shared/threadWorktree'
import type { ThreadManager } from '../services/conversation/thread-manager'
import type { ThreadProjectService } from '../services/conversation/thread-projects'
import type { ThreadWorktreeHost } from '../services/conversation/thread-worktree'

interface Deps {
  db: AppDatabase
  manager: Promise<ThreadManager>
  threadProjects: ThreadProjectService
  worktrees?: ThreadWorktreeHost
  /** Rejects calls that do not come from the application's main frame. */
  sender(event: IpcMainInvokeEvent): void
  id(value: unknown): string
}

/**
 * Cleaning up the worktree a conversation was started in. The renderer names only the conversation and the
 * person's choice; which folder is removed always comes from the record the app wrote at creation, and the
 * removal is the Worktrees panel's own guarded one.
 */
export function registerThreadWorktreeIpc({ db, manager, threadProjects, worktrees, sender, id }: Deps): void {
  ipcMain.handle(IPC_CHANNELS.thread.worktreeInspect, async (event, threadId: unknown) => {
    sender(event)
    const owned = (await manager).read(id(threadId)).thread.ownedWorktree
    if (!owned) return null
    return (await import('../services/conversation/thread-worktree-lifecycle')).inspectThreadWorktree(owned)
  })

  ipcMain.handle(IPC_CHANNELS.thread.worktreeFinish, async (event, threadId: unknown, action: unknown, choice: unknown): Promise<ThreadWorktreeFinishResult> => {
    sender(event)
    if (action !== 'archive' && action !== 'delete') throw new Error('Choose archive or delete')
    if (choice !== 'auto' && choice !== 'keep' && choice !== 'discard') throw new Error('Choose keep, clean up or discard')
    const service = await manager
    const { endThreadWithWorktree } = await import('../services/conversation/thread-worktree-lifecycle')
    const { threadsInWorktree } = await import('../services/conversation/thread-worktree')
    return endThreadWithWorktree({
      read: key => service.read(key),
      command: (key, text) => service.command(key, text),
      remover: worktrees?.removeWorktree ? { removeWorktree: input => worktrees.removeWorktree!(input) } : undefined,
      removeContext: (projectId, path) => threadProjects.removeContext(projectId, path),
      // Reading conversations is best effort: removal keeps its own safeguards when it fails.
      otherThreadsInside: (path, except) => { try { return threadsInWorktree(db, path).filter(other => other.id !== except).length } catch { return 0 } }
    }, id(threadId), action, choice as ThreadWorktreeChoice)
  })
}
