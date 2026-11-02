import { ipcMain } from 'electron'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { isThreadSectionsWorkspaceId } from '../../../shared/thread-sections'
import type { ThreadSections, ThreadSectionsSaveResult } from '../../../shared/types/thread-sections'
import type { ThreadSectionsStore } from '../services/conversation/thread-sections'

interface Deps {
  db: AppDatabase
}

/**
 * F13 · Sections of the conversation list. The store is loaded on the first call, not with the thread module. Only the
 * app window's main frame reaches these handlers: the central sender guard (B12) refuses every other sender.
 */
export function registerThreadSectionsIpc({ db }: Deps): void {
  let store: Promise<ThreadSectionsStore> | null = null
  const load = (): Promise<ThreadSectionsStore> => store ??= import('../services/conversation/thread-sections').then(({ ThreadSectionsStore }) => new ThreadSectionsStore(db))

  ipcMain.handle(IPC_CHANNELS.thread.sections, async (_event, workspaceId: unknown): Promise<ThreadSections> => {
    if (!isThreadSectionsWorkspaceId(workspaceId)) throw new Error('thread.sections.invalid')
    const sections = await load()
    if (!sections.exists(workspaceId)) throw new Error('thread.sections.unknownWorkspace')
    return sections.list(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.thread.saveSections, async (_event, workspaceId: unknown, state: unknown): Promise<ThreadSectionsSaveResult> => {
    return (await load()).save(workspaceId, state)
  })
}
