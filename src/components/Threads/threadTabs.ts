/** The conversation's tabs (DESIGN U4.8): Conversation always, every other tab only once it has something to show. */
export type ThreadTabId = 'conversation' | 'changes' | 'terminal' | 'containers' | 'network' | 'pull-request'

export interface ThreadTabsState {
  changedFiles: number
  panes: number
  composePlace: boolean
  httpCalls: number
  pullRequest: boolean
  done: boolean
}

export function visibleThreadTabs(state: ThreadTabsState): ThreadTabId[] {
  const tabs: ThreadTabId[] = ['conversation']
  if (state.changedFiles > 0) tabs.push('changes')
  if (state.panes > 0) tabs.push('terminal')
  if (state.composePlace) tabs.push('containers')
  if (state.httpCalls > 0) tabs.push('network')
  if (state.pullRequest || state.done) tabs.push('pull-request')
  return tabs
}

/** A Compose working folder belongs to a place when it is the place or under it with a separator; a shared prefix does not count. */
export function isUnderPlace(folder: string, place: string, windows: boolean): boolean {
  const norm = (value: string): string => {
    const slashed = value.replace(/\\/g, '/').replace(/\/+$/, '')
    return windows ? slashed.toLowerCase() : slashed
  }
  const dir = norm(folder)
  const root = norm(place)
  if (!dir || !root) return false
  return dir === root || dir.startsWith(`${root}/`)
}
