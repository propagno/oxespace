/**
 * What the command palette can ask OxePod to do. OxePod is lazy: nothing of it loads until its view first opens, so
 * the palette goes through this small module, which App imports. App switches to OxePod first, then the action runs
 * through the store, or through the control a person would have used.
 */
export type OxePodAction = 'open' | 'resources' | 'activity' | 'filter' | 'pruneContainers'

type Listener = (action: OxePodAction) => void
const listeners = new Set<Listener>()

/** App subscribes once: it opens the view, then calls `performOxePodAction`. */
export function onOxePodAction(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function requestOxePodAction(action: OxePodAction): void {
  listeners.forEach(listener => listener(action))
}

const WAIT_MS = 2000
const RETRY_MS = 100

/** Focuses the sidebar's filter, expanding the sidebar first; the view may only just be mounting. */
async function focusFilter(): Promise<void> {
  const { useUIStore } = await import('../../store/ui.store')
  if (useUIStore.getState().isSidebarCollapsed) useUIStore.getState().toggleSidebar()
  let attempts = 0
  const attempt = (): void => {
    const input = document.querySelector<HTMLInputElement>('[data-pod-filter]')
    if (input) { input.focus(); input.select(); return }
    // Counted, not timed, so a frozen or adjusted clock cannot make it retry forever.
    if (++attempts < WAIT_MS / RETRY_MS) window.setTimeout(attempt, RETRY_MS)
  }
  attempt()
}

export function performOxePodAction(action: OxePodAction): void {
  if (action === 'open') return
  if (action === 'filter') { void focusFilter(); return }
  void import('./oxepod.store').then(({ useOxePodStore }) => {
    const store = useOxePodStore.getState()
    if (action === 'resources') store.show('resources')
    else if (action === 'activity') store.show('activity')
    else store.askPrune('containers')
  })
}
