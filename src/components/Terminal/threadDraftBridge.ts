import { useThreadStore } from '../../store/thread.store'

/** Subscribes the App shell to AG-08 terminal-to-OxeChat draft routing events without pulling full routing into entry. */
export function attachOpenThreadDraftListener(handlers: {
  selectThreadMode: () => void
  openNewThread: (projectId: string | null, rootPath?: string) => void
}): () => void {
  const onOpenDraft = (event: Event): void => {
    const detail = (
      event as CustomEvent<{ threadId: string | null; projectId?: string | null; rootPath?: string; draftLength?: number }>
    ).detail
    if (!detail) return
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
  return () => window.removeEventListener('oxe:open-thread-draft', onOpenDraft)
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
