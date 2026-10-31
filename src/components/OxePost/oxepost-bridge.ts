/**
 * What the command palette can ask OxePost to do. OxePost is lazy: nothing of it loads until its view first opens,
 * so the palette goes through this small module, which App imports. App switches to OxePost first, then the action
 * runs through the store, or through the control a person would have used.
 */
export type OxePostAction = 'open' | 'newRequest' | 'filter' | 'import' | 'environments'

type Listener = (action: OxePostAction) => void
const listeners = new Set<Listener>()

/** App subscribes once: it opens the view, then calls `performOxePostAction`. */
export function onOxePostAction(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function requestOxePostAction(action: OxePostAction): void {
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
    const input = document.querySelector<HTMLInputElement>('[data-post-filter]')
    if (input) { input.focus(); input.select(); return }
    // Counted, not timed, so a frozen or adjusted clock cannot make it retry forever.
    if (++attempts < WAIT_MS / RETRY_MS) window.setTimeout(attempt, RETRY_MS)
  }
  attempt()
}

export function performOxePostAction(action: OxePostAction): void {
  if (action === 'open') return
  if (action === 'filter') { void focusFilter(); return }
  void import('./oxepost.store').then(({ useOxePostStore }) => {
    const store = useOxePostStore.getState()
    if (action === 'newRequest') store.newRequest()
    else store.show(action)
  })
}
