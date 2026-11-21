import { i18n } from '../../i18n'

export type ThreadMoreActionId =
  | 'rename'
  | 'pin'
  | 'delegate'
  | 'mcp'
  | 'larger-text'
  | 'show-every-tool-call'
  | 'details'
  | 'fork'
  | 'export'
  | 'archive'
  | 'delete'

const ACTION_KEYS: ReadonlyArray<readonly [ThreadMoreActionId, string]> = [
  ['rename', 'thread:moreActions.rename'],
  ['pin', 'thread:moreActions.pin'],
  ['delegate', 'thread:moreActions.delegate'],
  ['mcp', 'thread:moreActions.mcp'],
  ['larger-text', 'thread:moreActions.largerText'],
  ['show-every-tool-call', 'thread:moreActions.showEveryToolCall'],
  ['details', 'thread:moreActions.details'],
  ['fork', 'thread:moreActions.fork'],
  ['export', 'thread:moreActions.export'],
  ['archive', 'thread:moreActions.archive'],
  ['delete', 'thread:moreActions.delete']
]

export const THREAD_MORE_ACTIONS: ReadonlyArray<{ id: string; label: string }> = ACTION_KEYS.map(([id, key]) => ({
  id,
  get label(): string {
    return i18n.t(key as never)
  }
}))

/** The ⋯ menu in the four groups of BRD-21 (OXE-167): conversation, reading, elsewhere ("Abrir no OxeCode" first), destructive. */
export const THREAD_MORE_ACTION_GROUPS: ReadonlyArray<ReadonlyArray<ThreadMoreActionId | 'open-in-code'>> = [
  ['rename', 'pin', 'delegate', 'mcp'],
  ['larger-text', 'show-every-tool-call', 'details'],
  ['open-in-code', 'fork', 'export'],
  ['archive', 'delete']
]

const OPEN_IN_CODE_EVENT = 'oxe:thread-open-in-code'

/** Asks the app shell to open a folder in OxeCode, as the project menu of the sidebar does. */
export function requestThreadOpenInCode(path: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_IN_CODE_EVENT, { detail: path }))
}

/** The app shell's side of requestThreadOpenInCode; returns the unsubscribe. */
export function onThreadOpenInCode(handler: (path: string) => void): () => void {
  const listener = (event: Event): void => {
    const path = (event as CustomEvent<unknown>).detail
    if (typeof path === 'string' && path) handler(path)
  }
  window.addEventListener(OPEN_IN_CODE_EVENT, listener)
  return () => window.removeEventListener(OPEN_IN_CODE_EVENT, listener)
}
