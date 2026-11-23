import { i18n } from '../../i18n'

/** What a conversation's status actions ask of the view (NowLine's buttons; More actions' Open pull request). */
export type NowLineAction = 'deny' | 'allow' | 'see-impact' | 'answer' | 'stop' | 'retry' | 'open-pr'

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

/**
 * The ⋯ menu in the four groups of BRD-21 (OXE-167): conversation, reading, elsewhere ("Abrir no OxeCode" first), destructive.
 * Open pull request ends the third group, and only when the conversation's pull request has a URL (OXE-388): the PR bar
 * shows an open one only, so a merged or closed one opens from here.
 */
export const THREAD_MORE_ACTION_GROUPS: ReadonlyArray<ReadonlyArray<ThreadMoreActionId | 'open-in-code' | 'open-pull-request'>> = [
  ['rename', 'pin', 'delegate', 'mcp'],
  ['larger-text', 'show-every-tool-call', 'details'],
  ['open-in-code', 'fork', 'export', 'open-pull-request'],
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
