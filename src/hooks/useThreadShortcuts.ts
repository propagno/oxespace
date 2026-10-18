import { useEffect } from 'react'
import { useThreadStore } from '../store/thread.store'
import { adjacentThreadId, navigableThreads } from '../utils/threadNavigation'

/**
 * Keyboard navigation for Thread mode:
 *   Ctrl+Alt+PageDown / PageUp  next / previous conversation
 *   Ctrl+Alt+N                  new conversation
 *
 * Active only while Thread mode is showing. Uses Ctrl+Alt so it never competes
 * with typing in the composer or with the terminal's own bindings.
 */
export function useThreadShortcuts(enabled: boolean, onNewThread: () => void): void {
  useEffect(() => {
    if (!enabled) return
    const handler = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        onNewThread()
        return
      }
      const delta = event.key === 'PageDown' ? 1 : event.key === 'PageUp' ? -1 : 0
      if (!delta) return
      const { threads, hiddenProjects, selectedId, select } = useThreadStore.getState()
      const target = adjacentThreadId(navigableThreads([...threads], hiddenProjects), selectedId, delta)
      if (!target) return
      event.preventDefault()
      void select(target)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, onNewThread])
}
