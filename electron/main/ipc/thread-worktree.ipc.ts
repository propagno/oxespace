import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ThreadWorktreeChoice, ThreadWorktreeFinishAction, ThreadWorktreeFinishResult } from '../../../shared/threadWorktree'
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
    const service = await manager, key = id(threadId)
    const { thread } = service.read(key)
    const owned = thread.ownedWorktree
    // The conversation ends first: this stops its agent, which would otherwise hold the folder open.
    await service.command(key, `/${action as ThreadWorktreeFinishAction} confirm`)
    if (!owned) return { removed: false, left: 'missing' }
    if (choice === 'keep') return { removed: false, left: 'chosen' }
    if (!worktrees?.removeWorktree) return { removed: false, left: 'refused', detail: 'Worktrees are unavailable in this session.' }
    const { finishThreadWorktree } = await import('../services/conversation/thread-worktree-lifecycle')
    const { threadsInWorktree } = await import('../services/conversation/thread-worktree')
    const remover = worktrees.removeWorktree.bind(worktrees)
    const others = (): number => { try { return threadsInWorktree(db, owned.path).filter(other => other.id !== key).length } catch { return 0 } }
    const result = await finishThreadWorktree({ removeWorktree: remover }, owned, choice as ThreadWorktreeChoice, others)
    if (result.removed) threadProjects.removeContext(thread.projectId, owned.path)
    return result
  })
}
