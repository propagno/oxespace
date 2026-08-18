import type { GitHubPanelTab } from '../../../shared/types/github'

export const GITHUB_PANEL_TABS: ReadonlyArray<{ id: GitHubPanelTab; label: string; remote?: boolean }> = [
  { id: 'status', label: 'Status' },
  { id: 'checkpoints', label: 'Checkpoints' },
  { id: 'repos', label: 'Repos' },
  { id: 'branches', label: 'Branches' },
  { id: 'prs', label: 'PRs', remote: true },
  { id: 'commits', label: 'Commits' },
  { id: 'releases', label: 'Releases', remote: true },
  { id: 'actions', label: 'Actions', remote: true },
  { id: 'settings', label: 'Settings' }
]

export function buildStatusHeadline(input: {
  ahead: number
  behind: number
  dirty: boolean
  totalFiles: number
  hasRemote: boolean
}): string {
  const { ahead, behind, dirty, totalFiles, hasRemote } = input
  if (!hasRemote) return 'No remote · configure origin to sync'
  const parts: string[] = []
  if (behind > 0) parts.push(`${behind} to pull`)
  if (ahead > 0) parts.push(`${ahead} to push`)
  if (dirty || totalFiles > 0) parts.push(`${totalFiles} file${totalFiles === 1 ? '' : 's'} changed`)
  return parts.length === 0 ? 'Up to date with remote · clean working tree' : parts.join(' · ')
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
  if (!hasRemote) return { kind: 'no-remote', title: 'No remote configured', detail: 'Fetch/Pull/Push need an origin. Add one with git remote add, then Refresh.' }
  if (behind > 0 && ahead > 0) return { kind: 'diverged', title: 'Branch diverged from remote', detail: `${behind} to pull · ${ahead} to push. Fast-forward Pull may fail — use the terminal for rebase/merge if needed.` }
  if (behind > 0 && dirty) return { kind: 'dirty-behind', title: `${behind} commit${behind === 1 ? '' : 's'} to pull`, detail: 'You also have local uncommitted changes. Commit or stash first so Pull does not mix remote history with a dirty tree.' }
  if (behind > 0) return { kind: 'behind', title: `${behind} commit${behind === 1 ? '' : 's'} to pull`, detail: 'Remote is ahead of you. Pull downloads with fast-forward only (safe).' }
  if (ahead > 0) return { kind: 'ahead', title: `${ahead} commit${ahead === 1 ? '' : 's'} to push`, detail: 'Your local commits are not on the remote yet. Push publishes this branch.' }
  return {
    kind: 'ok',
    title: 'In sync with remote',
    detail: dirty ? 'Nothing to pull or push. You have local changes — stage and commit below.' : 'Nothing to pull or push. Fetch occasionally to check for remote updates.'
  }
}
