import type { ThreadProvider } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'

export interface IsolatedNewConversationHandoff {
  projectId: string
  rootPath?: string
  provider?: ThreadProvider
  draft: string
}

let pendingIsolatedHandoff: IsolatedNewConversationHandoff | null = null

/** Reads and clears a one-shot handoff when exiting the parallel screen to a new isolated conversation (OXE-189 CA-4). */
export function consumeIsolatedNewConversationHandoff(projectId: string, rootPath?: string): IsolatedNewConversationHandoff | null {
  const handoff = pendingIsolatedHandoff
  if (!handoff) return null
  if (handoff.projectId !== projectId && (!rootPath || handoff.rootPath !== rootPath)) return null
  pendingIsolatedHandoff = null
  return handoff
}

/** Subscribes the App shell to AG-08 terminal-to-OxeChat draft routing events without pulling full routing into entry. */
export function attachOpenThreadDraftListener(handlers: {
  selectThreadMode: () => void
  openNewThread: (projectId: string | null, rootPath?: string) => void
}): () => void {
  const onOpenDraft = (event: Event): void => {
    const detail = (
      event as CustomEvent<{
        threadId: string | null
        projectId?: string | null
        rootPath?: string
        draftLength?: number
        isolated?: { provider?: ThreadProvider; draft: string }
      }>
    ).detail
    if (!detail) return
    if (detail.isolated) {
      pendingIsolatedHandoff = {
        projectId: detail.projectId ?? '',
        rootPath: detail.rootPath || undefined,
        provider: detail.isolated.provider,
        draft: detail.isolated.draft
      }
    }
    handlers.selectThreadMode()
    if (!detail.threadId) {
      handlers.openNewThread(detail.projectId ?? null, detail.rootPath || undefined)
    }
    requestAnimationFrame(() => {
      const composer = document.querySelector<HTMLTextAreaElement>('[data-thread-composer="true"]')
      if (!composer) return
      composer.focus()
      const pos = detail.draftLength ?? composer.value.length
      composer.setSelectionRange(pos, pos)
    })
  }
  window.addEventListener('oxe:open-thread-draft', onOpenDraft)
  return () => {
    pendingIsolatedHandoff = null
    window.removeEventListener('oxe:open-thread-draft', onOpenDraft)
  }
}

export const newProjectDraftKey = (projectIdOrPath: string): string => `new:${projectIdOrPath}`

/** Leaves text for the next new conversation in this project (a welcome starter, OXE-338), after any draft already
 * waiting there, so the new conversation opens with it in its composer. */
export function queueNewConversationDraft(projectId: string, text: string): void {
  if (!text.trim()) return
  const store = useThreadStore.getState()
  const key = newProjectDraftKey(projectId)
  const waiting = store.drafts[key] ?? ''
  store.setDraft(key, waiting.trim() ? `${waiting}\n\n${text}` : text)
}
