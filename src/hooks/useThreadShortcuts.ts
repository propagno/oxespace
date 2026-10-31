import { useKeybindings } from '../keyboard/keybindings'
import { useThreadStore } from '../store/thread.store'
import { adjacentThreadId, navigableThreads } from '../utils/threadNavigation'

function stepThread(delta: 1 | -1): false | void {
  const { threads, hiddenProjects, selectedId, select } = useThreadStore.getState()
  const target = adjacentThreadId(navigableThreads([...threads], hiddenProjects), selectedId, delta)
  if (!target) return false
  void select(target)
}

/**
 * Keyboard navigation for Thread mode (chords in src/keyboard/keybindings.ts):
 * next / previous conversation and a new conversation. Uses Ctrl+Alt so it
 * never competes with typing in the composer or with the terminal's own bindings.
 */
export function useThreadShortcuts(enabled: boolean, onNewThread: () => void): void {
  useKeybindings({ 'thread.new': onNewThread, 'thread.next': () => stepThread(1), 'thread.previous': () => stepThread(-1) }, enabled)
}
