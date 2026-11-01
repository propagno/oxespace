import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { isThreadSectionsWorkspaceId } from '../../../shared/thread-sections'
import type { ThreadSections, ThreadSectionsSaveResult } from '../../../shared/types/thread-sections'
import type { ThreadSectionsStore } from '../services/conversation/thread-sections'

interface Deps {
  db: AppDatabase
  /** Rejects calls that do not come from the application's main frame. */
  sender(event: IpcMainInvokeEvent): void
}

/** F13 · Sections of the conversation list. The store is loaded on the first call, not with the thread module. */
export function registerThreadSectionsIpc({ db, sender }: Deps): void {
  let store: Promise<ThreadSectionsStore> | null = null
  const load = (): Promise<ThreadSectionsStore> => store ??= import('../services/conversation/thread-sections').then(({ ThreadSectionsStore }) => new ThreadSectionsStore(db))

  ipcMain.handle(IPC_CHANNELS.thread.sections, async (event, workspaceId: unknown): Promise<ThreadSections> => {
    sender(event)
    if (!isThreadSectionsWorkspaceId(workspaceId)) throw new Error('thread.sections.invalid')
    const sections = await load()
    if (!sections.exists(workspaceId)) throw new Error('thread.sections.unknownWorkspace')
    return sections.list(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.thread.saveSections, async (event, workspaceId: unknown, state: unknown): Promise<ThreadSectionsSaveResult> => {
    sender(event)
    return (await load()).save(workspaceId, state)
  })
}
