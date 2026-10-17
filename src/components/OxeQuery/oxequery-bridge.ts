/**
 * What the command palette can ask OxeQuery to do. OxeQuery is lazy: nothing of it is loaded until its view is first opened,
 * so the palette goes through this small module, which App imports, instead of reaching into the view.
 * App switches to the OxeQuery view; the action then finds the control a person would have clicked and uses it.
 */
export type OxeQueryAction =
  | 'open' | 'newConnection' | 'newQuery' | 'runAll' | 'searchObjects' | 'newTable' | 'settings'
  | 'importConnections' | 'exportConnections' | 'compose'

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

const buttonByText = (text: string): HTMLElement | null => [...document.querySelectorAll<HTMLElement>('.oq-view button')].find(element => element.textContent?.trim().startsWith(text) && !(element as HTMLButtonElement).disabled) ?? null

const FINDERS: Record<Exclude<OxeQueryAction, 'open'>, () => HTMLElement | null> = {
  newConnection: () => document.querySelector<HTMLElement>('[aria-label="New connection"]') ?? buttonByText('New connection'),
  newQuery: () => document.querySelector<HTMLElement>('[aria-label="New query"]'),
  runAll: () => buttonByText('Run all'),
  searchObjects: () => document.querySelector<HTMLElement>('input[aria-label="Search objects"]') ?? document.querySelector<HTMLElement>('input[aria-label="Filter collections"]'),
  newTable: () => buttonByText('New table'),
  settings: () => document.querySelector<HTMLElement>('[aria-label="OxeQuery settings"]'),
  importConnections: () => document.querySelector<HTMLElement>('[aria-label="Import connections"]'),
  exportConnections: () => document.querySelector<HTMLElement>('[aria-label="Export connections"]'),
  compose: () => [...document.querySelectorAll<HTMLElement>('.oq-view [role="tab"]')].find(element => element.textContent?.trim() === 'Containers') ?? null
}

/** Waits (up to two seconds) for the control to exist, because the view may have only just mounted. */
export function performOxeQueryAction(action: OxeQueryAction): void {
  if (action === 'open') return
  const started = Date.now()
  const attempt = (): void => {
    const target = FINDERS[action]()
    if (target) { if (target instanceof HTMLInputElement) target.focus(); else target.click(); return }
    if (Date.now() - started < 2000) window.setTimeout(attempt, 100)
  }
  attempt()
}
