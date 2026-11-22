import { useEffect } from 'react'
import { useThreadStore } from '../store/thread.store'

/** The window event that takes the app to OxeChat on one conversation (OXE-332), as 'oxe:open-pane' does to OxeCode. */
export const OPEN_THREAD_EVENT = 'oxe:open-thread'

/** Listens to 'oxe:open-thread' while mounted: selects the 'thread' view and that conversation. App calls it. */
export function useOpenThreadListener(selectMode: (view: 'thread') => void): void {
  useEffect(() => {
    const open = (event: Event): void => {
      const threadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId
      if (typeof threadId !== 'string' || threadId.length === 0) return
      selectMode('thread')
      void useThreadStore.getState().select(threadId)
    }
    window.addEventListener(OPEN_THREAD_EVENT, open)
    return () => window.removeEventListener(OPEN_THREAD_EVENT, open)
  }, [selectMode])
}
