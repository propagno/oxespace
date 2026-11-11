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
