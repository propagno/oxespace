import { useSyncExternalStore } from 'react'
import type { AppView } from '../keyboard/keybindings'

/**
 * The application view on screen. Views stay mounted while hidden (their state survives a switch), so a part that
 * must only act while it is seen reads this instead of its own mount (T40: leaving OxeChat withdraws the archive
 * offer). App sets it with each committed view.
 */
let shown: AppView = 'code'
const listeners = new Set<() => void>()

export function setShownView(view: AppView): void {
  if (shown === view) return
  shown = view
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useShownView(): AppView {
  return useSyncExternalStore(subscribe, () => shown, () => shown)
}
