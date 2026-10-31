/**
 * What the command palette can ask OxeQuery to do. OxeQuery is lazy: nothing of it is loaded until its view is first opened,
 * so the palette goes through this small module, which App imports, instead of reaching into the view.
 * App switches to the OxeQuery view; the action then runs through the store, or uses the control a person would have
 * used in the panel on screen. When the panel on screen has no such control (no connection open, a read-only one),
 * a toast says what is needed instead of the palette doing nothing.
 */
export type OxeQueryAction =
  | 'open' | 'newConnection' | 'newDatabase' | 'newQuery' | 'runAll' | 'searchObjects' | 'newTable' | 'settings'
  | 'importConnections' | 'exportConnections' | 'activity' | 'connect'

/** Where `connect` goes: a saved connection, or a new one filled in from a container (roadmap P5). */
export type ConnectTarget = { connectionId: string } | { draft: import('./oxequery.store').ConnectionDraft }
let pendingConnect: ConnectTarget | null = null

type Listener = (action: OxeQueryAction) => void
const listeners = new Set<Listener>()

/** App subscribes once: it opens the view, then calls `performOxeQueryAction`. */
export function onOxeQueryAction(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function requestOxeQueryAction(action: OxeQueryAction): void {
  listeners.forEach(listener => listener(action))
}

/** OxePod's "Connect in OxeQuery": opens OxeQuery on the saved connection, or on a new one with host and port filled in. */
export function requestOxeQueryConnect(target: ConnectTarget): void {
  pendingConnect = target
  requestOxeQueryAction('connect')
}

/** Actions that act on a control of the panel on screen, found by its `data-oq-action` hook (never by its text, which is translated). */
type ControlAction = 'newQuery' | 'runAll' | 'searchObjects' | 'newTable'
const CONTROL_ACTIONS = new Set<OxeQueryAction>(['newQuery', 'runAll', 'searchObjects', 'newTable'])
const WAIT_MS = 2000
const RETRY_MS = 100

/** The control in the visible panel; hidden tabs keep their own copies in the page and must not be clicked. */
export function findControl(action: ControlAction, root: ParentNode = document): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(`.oq-panel:not([hidden]) [data-oq-action="${action}"]`)]
    .find(element => !(element as HTMLButtonElement).disabled) ?? null
}

async function viaStore(action: Exclude<OxeQueryAction, ControlAction | 'open'>): Promise<void> {
  const { useOxeQueryStore } = await import('./oxequery.store')
  const store = useOxeQueryStore.getState()
  if (action === 'newConnection') { store.openDialog(null); return }
  if (action === 'settings') { store.setPreferencesOpen(true); return }
  if (action === 'newDatabase') { store.setNewDatabaseOpen(true); return }
  if (action === 'activity') { store.openActivity(); return }
  if (action === 'connect') {
    const target = pendingConnect
    pendingConnect = null
    if (!target) return
    if ('draft' in target) { store.openDialog(null, target.draft); return }
    await store.refreshConnections()
    const saved = useOxeQueryStore.getState().connections.find(item => item.id === target.connectionId)
    if (saved) store.openConnection(saved)
    return
  }
  const [{ importConnections, exportConnections }, { loadOxeQueryCatalog, tq }, { toast }, { errorMessage }] = await Promise.all([import('./connection-transfer'), import('./catalog'), import('../../ui/Toast'), import('./client')])
  // The palette can run before the view has listed the connections (or loaded its catalog): export counts them first.
  await loadOxeQueryCatalog()
  try {
    if (action === 'exportConnections') await store.refreshConnections()
    await (action === 'importConnections' ? importConnections() : exportConnections())
  }
  catch (cause) { toast({ title: tq(action === 'importConnections' ? 'palette.importFailed' : 'palette.exportFailed'), description: errorMessage(cause), intent: 'danger' }) }
}

async function explain(action: ControlAction): Promise<void> {
  const [{ loadOxeQueryCatalog, tq }, { toast }] = await Promise.all([import('./catalog'), import('../../ui/Toast')])
  await loadOxeQueryCatalog()
  toast({ title: tq('palette.nothingYet'), description: tq(`palette.unavailable.${action}`), intent: 'info' })
}

export function performOxeQueryAction(action: OxeQueryAction): void {
  if (action === 'open') return
  if (!CONTROL_ACTIONS.has(action)) { void viaStore(action as Exclude<OxeQueryAction, ControlAction | 'open'>); return }
  const control = action as ControlAction
  let attempts = 0
  const attempt = (): void => {
    const target = findControl(control)
    if (target) { if (target instanceof HTMLInputElement) target.focus(); else target.click(); return }
    // The view may have only just mounted; past the wait, the panel on screen simply has no such control.
    // Counted, not timed, so a frozen or adjusted clock cannot make it retry forever.
    if (++attempts < WAIT_MS / RETRY_MS) window.setTimeout(attempt, RETRY_MS)
    else void explain(control)
  }
  attempt()
}
