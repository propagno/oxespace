/**
 * F13 · Sections of the conversation list for the E2E runs, kept in memory and checked by the same shared validator
 * as the main process. A Code workspace must be one the mock created; any `thread:<project id>` exists, since the
 * mock keeps no Thread projects. The mock keeps no conversations either, so no assignment is dropped as gone.
 */
import { ipcMain } from 'electron'
import { emptyThreadSections, isThreadSectionsWorkspaceId, normalizeThreadSections, threadSectionsRefusal } from '../../../shared/thread-sections'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ThreadSections, ThreadSectionsSaveResult } from '../../../shared/types/thread-sections'

export function registerThreadSectionsMock(codeWorkspaceExists: (id: string) => boolean): void {
  const stored = new Map<string, ThreadSections>()
  const exists = (id: string): boolean => id.startsWith('thread:') ? id.length > 'thread:'.length : codeWorkspaceExists(id)

  ipcMain.handle(IPC_CHANNELS.thread.sections, (_event, workspaceId: unknown): ThreadSections => {
    if (!isThreadSectionsWorkspaceId(workspaceId)) throw new Error('thread.sections.invalid')
    if (!exists(workspaceId)) { stored.delete(workspaceId); throw new Error('thread.sections.unknownWorkspace') }
    return structuredClone(stored.get(workspaceId) ?? emptyThreadSections())
  })
  ipcMain.handle(IPC_CHANNELS.thread.saveSections, (_event, workspaceId: unknown, state: unknown): ThreadSectionsSaveResult => {
    if (!isThreadSectionsWorkspaceId(workspaceId)) return threadSectionsRefusal('invalid')
    if (!exists(workspaceId)) { stored.delete(workspaceId); return threadSectionsRefusal('unknownWorkspace') }
    const checked = normalizeThreadSections(state, () => true)
    if (checked.ok) stored.set(workspaceId, structuredClone(checked.state))
    return checked
  })
}
