import type { GitHubPanelTab } from '../../../shared/types/github'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

function tab(id: GitHubPanelTab, remote?: boolean): { id: GitHubPanelTab; readonly label: string; remote?: boolean } {
  return { id, remote, get label() { return tc(`git.tabs.${id}`) } }
}

/** The panel's tabs; labels are read in the interface language each time. */
export const GITHUB_PANEL_TABS: ReadonlyArray<{ id: GitHubPanelTab; readonly label: string; remote?: boolean }> = [
  tab('status'),
  tab('checkpoints'),
  tab('repos'),
  tab('branches'),
  tab('prs', true),
  tab('commits'),
  tab('releases', true),
  tab('actions', true),
  tab('settings')
]

export function buildStatusHeadline(input: {
  ahead: number
  behind: number
  dirty: boolean
  totalFiles: number
  hasRemote: boolean
}): string {
  const { ahead, behind, dirty, totalFiles, hasRemote } = input
  if (!hasRemote) return tc('git.sync.headlineNoRemote')
  const parts: string[] = []
  if (behind > 0) parts.push(tc('git.sync.toPull', { count: behind }))
  if (ahead > 0) parts.push(tc('git.sync.toPush', { count: ahead }))
  if (dirty || totalFiles > 0) parts.push(tc('git.sync.filesChanged', { count: totalFiles }))
  return parts.length === 0 ? tc('git.sync.headlineClean') : parts.join(' · ')
}

export type GitHubSyncState = {
  kind: 'ok' | 'behind' | 'ahead' | 'diverged' | 'dirty-behind' | 'no-remote' | 'unknown'
  title: string
  detail: string
}

export function describeSyncState(input: {
  ahead: number
  behind: number
  dirty: boolean
  hasRemote: boolean
  totalFiles?: number
}): GitHubSyncState {
  const { ahead, behind, dirty, hasRemote } = input
  if (!hasRemote) return { kind: 'no-remote', title: tc('git.sync.noRemote'), detail: tc('git.sync.noRemoteDetail') }
  if (behind > 0 && ahead > 0) return { kind: 'diverged', title: tc('git.sync.diverged'), detail: tc('git.sync.divergedDetail', { behind, ahead }) }
  if (behind > 0 && dirty) return { kind: 'dirty-behind', title: tc('git.sync.commitsToPull', { count: behind }), detail: tc('git.sync.dirtyBehindDetail') }
  if (behind > 0) return { kind: 'behind', title: tc('git.sync.commitsToPull', { count: behind }), detail: tc('git.sync.behindDetail') }
  if (ahead > 0) return { kind: 'ahead', title: tc('git.sync.commitsToPush', { count: ahead }), detail: tc('git.sync.aheadDetail') }
  return { kind: 'ok', title: tc('git.sync.inSync'), detail: dirty ? tc('git.sync.inSyncDirty') : tc('git.sync.inSyncClean') }
}
