import type { GitDiffSummary, GitDiffSummaryFile, GitSummaryStatus } from '../../../shared/types/git'
import type { ThreadProvider, ThreadSnapshot, ThreadTurnFileStatus } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { threadChanges } from '../Threads/threadChanges'

export interface LastTurnTarget {
  threadId: string
  turnId: string | null
  provider: ThreadProvider
  snapshot: ThreadSnapshot
}

export interface LastTurnDiffResult {
  summary: GitDiffSummary
  rootPath: string
  threadId: string | null
  turnId: string | null
  hasTurn: boolean
}

const normalizePath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

const samePath = (a: string, b: string): boolean => normalizePath(a) === normalizePath(b)

function fileStatusFromTurnFile(file: ThreadTurnFileStatus): GitSummaryStatus {
  if (!file.preExists && file.postExists) return 'A'
  if (file.preExists && !file.postExists) return 'D'
  return 'M'
}

function lastTurnIdFromSnapshot(snapshot: ThreadSnapshot): string | null {
  const fromTurns = snapshot.turns?.at(-1)?.id
  if (fromTurns) return fromTurns
  for (let i = snapshot.events.length - 1; i >= 0; i -= 1) {
    const event = snapshot.events[i]
    if (event.type === 'turn-diff' && event.turnId) return event.turnId
    if (event.type === 'tool' && event.turnId) return event.turnId
  }
  return null
}

function relativeToRoot(filePath: string, rootPath: string): string {
  const normalizedFile = filePath.replace(/\\/g, '/')
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalizedFile.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1)
  }
  return normalizedFile
}

/**
 * Finds the active or most recently updated thread snapshot for the given workspace/root.
 */
export async function resolveLastTurnTarget({ workspaceId, rootPath, threadId }: {
  workspaceId: string
  rootPath: string
  threadId?: string
}): Promise<LastTurnTarget | null> {
  const state = useThreadStore.getState()
  const matchesContext = (candidate: { workspaceId: string; rootPath: string }): boolean =>
    candidate.workspaceId === workspaceId || samePath(candidate.rootPath, rootPath)

  let snapshot: ThreadSnapshot | null = null
  if (threadId) {
    snapshot = state.snapshot?.thread.id === threadId ? state.snapshot : state.snapshotCache[threadId] ?? null
  } else if (state.snapshot && matchesContext(state.snapshot.thread)) {
    snapshot = state.snapshot
  }

  let resolvedId = threadId ?? snapshot?.thread.id ?? null
  if (!resolvedId) {
    const matchingThreads = state.threads
      .filter(thread => !thread.archived && matchesContext(thread))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    resolvedId = matchingThreads[0]?.id ?? null
  }

  if (!snapshot && resolvedId) {
    snapshot = state.snapshotCache[resolvedId] ?? null
    if (!snapshot && window.oxe?.thread?.read) {
      try {
        snapshot = await window.oxe.thread.read(resolvedId)
      } catch {
        snapshot = null
      }
    }
  }

  if (!snapshot) return null
  return {
    threadId: snapshot.thread.id,
    turnId: lastTurnIdFromSnapshot(snapshot),
    provider: snapshot.thread.provider,
    snapshot
  }
}

/**
 * Loads the file diff summary for the last agent turn in the current workspace/thread.
 * Returns an empty summary with `hasTurn: false` when no turn is available.
 */
export async function loadLastTurnDiff({ workspaceId, rootPath, threadId }: {
  workspaceId: string
  rootPath: string
  threadId?: string
}): Promise<LastTurnDiffResult> {
  const emptySummary: GitDiffSummary = {
    files: [],
    additions: 0,
    deletions: 0,
    base: 'HEAD',
    mergeBase: null,
    includeUncommitted: false,
    compiledAt: Date.now()
  }

  const target = await resolveLastTurnTarget({ workspaceId, rootPath, threadId })
  if (!target || !target.turnId) {
    return { summary: emptySummary, rootPath, threadId: target?.threadId ?? null, turnId: null, hasTurn: false }
  }

  const { snapshot, turnId } = target
  let turnFiles: ThreadTurnFileStatus[] = []
  if (window.oxe?.thread?.turnFiles) {
    try {
      turnFiles = await window.oxe.thread.turnFiles(target.threadId, turnId)
    } catch {
      turnFiles = []
    }
  }

  const turnRoot = turnFiles.find(file => file.root)?.root
    ?? snapshot.thread.observedLocation?.checkoutRoot
    ?? rootPath

  let files: GitDiffSummaryFile[] = turnFiles.map(file => ({
    path: relativeToRoot(file.path, turnRoot),
    status: fileStatusFromTurnFile(file),
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    binary: false
  }))

  // Fallback when a turn has no checkpoint record: use files reported by tool events in that turn.
  if (files.length === 0) {
    const turnToolEvents = snapshot.events.filter(event => event.type === 'tool' && event.turnId === turnId)
    const reported = threadChanges(turnToolEvents)
    const seen = new Set<string>()
    files = reported.flatMap(entry => {
      const path = relativeToRoot(entry.file.path, turnRoot)
      if (seen.has(path)) return []
      seen.add(path)
      const status: GitSummaryStatus = entry.file.kind === 'add' ? 'A' : entry.file.kind === 'delete' ? 'D' : 'M'
      return [{
        path,
        status,
        additions: entry.file.additions ?? 0,
        deletions: entry.file.deletions ?? 0,
        binary: false
      }]
    })
  }

  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

  return {
    summary: {
      files,
      additions,
      deletions,
      base: 'HEAD',
      mergeBase: null,
      includeUncommitted: true,
      compiledAt: Date.now()
    },
    rootPath: turnRoot,
    threadId: target.threadId,
    turnId,
    hasTurn: true
  }
}
