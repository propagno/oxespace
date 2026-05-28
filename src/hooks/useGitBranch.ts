import { useEffect, useState } from 'react'
import type { GitBranchStatus } from '../../shared/types/git'

/**
 * Shared module-level cache for `git.getBranch` results, keyed by rootPath.
 * Both the pane statusbar and the sidebar row need the same branch info; with
 * a shared cache we avoid:
 *   - N parallel IPC calls when the workspace mounts N panes
 *   - one component knowing the branch while the other still says "branch
 *     unavailable" because they queried at slightly different times.
 *
 * The cache is held in module scope rather than zustand because branch
 * status is per-rootPath (not per-workspace), the data is read-only from
 * the renderer's perspective, and subscribers just need a re-render when the
 * value changes — a tiny pub-sub does that without the store ceremony.
 */
interface BranchEntry {
  status: GitBranchStatus | null
  lastFetchedMs: number
  inFlight: Promise<GitBranchStatus> | null
}

const cache = new Map<string, BranchEntry>()
const listeners = new Map<string, Set<() => void>>()
// One refcounted poller per unique rootPath. Previously each useGitBranch()
// caller (every TerminalPane statusbar, every sidebar row) created its own
// setInterval — so with N panes in a worktree, N git processes spawned every
// 10s. Now the first subscriber for a rootPath starts the poller; the last
// to leave stops it. Cost: O(unique rootPaths) instead of O(panes).
const pollers = new Map<string, { intervalId: number; subscribers: number; workspaceId: string }>()
const REFRESH_INTERVAL_MS = 10_000

function notify(rootPath: string): void {
  const set = listeners.get(rootPath)
  if (!set) return
  for (const fn of set) fn()
}

async function fetchBranch(workspaceId: string, rootPath: string): Promise<GitBranchStatus> {
  let entry = cache.get(rootPath)
  if (entry?.inFlight) return entry.inFlight

  // Guard against environments where the IPC bridge isn't fully wired —
  // notably integration tests that stub only a subset of `window.oxe`, and
  // the brief gap on app startup before preload finishes. Resolves to a
  // structured error instead of throwing so the cache still advances and
  // listeners see "we tried, got nothing".
  const gitApi = (typeof window !== 'undefined' && window.oxe && window.oxe.git) ?? null
  const promise: Promise<GitBranchStatus> = gitApi
    ? gitApi.getBranch({ workspaceId, rootPath }).catch((err) => ({
        branch: null,
        detached: false,
        shortSha: null,
        // Surface the actual error so the UI can show "Git not found" etc.
        // instead of the generic "branch unavailable" fallback.
        error: err instanceof Error ? err.message : String(err)
      } satisfies GitBranchStatus))
    : Promise.resolve({
        branch: null,
        detached: false,
        shortSha: null,
        error: 'Git IPC not available'
      } satisfies GitBranchStatus)

  entry = entry ?? { status: null, lastFetchedMs: 0, inFlight: null }
  entry.inFlight = promise
  cache.set(rootPath, entry)

  try {
    const next = await promise
    const stored = cache.get(rootPath) ?? entry
    stored.status = next
    stored.lastFetchedMs = Date.now()
    stored.inFlight = null
    cache.set(rootPath, stored)
    notify(rootPath)
    // One-shot diagnostic log per rootPath when the branch ends up null AND
    // an error string came back — gives the user immediate console evidence
    // of WHY the chip says "no branch" / "git not found" / etc, without
    // needing to mouse over the chip's tooltip. Subsequent successful reads
    // don't spam.
    if (!next.branch && !next.shortSha && next.error) {
      const sig = `${rootPath}::${next.error}`
      if (!loggedFailures.has(sig)) {
        loggedFailures.add(sig)
        // eslint-disable-next-line no-console
        console.warn(`[useGitBranch] ${rootPath} → ${next.error}`)
      }
    }
    return next
  } catch {
    const stored = cache.get(rootPath) ?? entry
    stored.inFlight = null
    cache.set(rootPath, stored)
    throw new Error('fetchBranch failed unexpectedly')
  }
}

// Tracks (rootPath, error) pairs that already produced a console warning so
// the 10s poll loop doesn't repeat the same line every interval.
const loggedFailures = new Set<string>()

/**
 * Subscribes to the branch status for `rootPath`. Polls every 10s; the cache
 * is shared so N concurrent subscribers cost 1 fetch per interval.
 *
 * Returns `null` until the first fetch resolves. After that, returns the
 * latest `GitBranchStatus` — which may have `branch === null` AND an `error`
 * string when git isn't available; the consumer is expected to display the
 * error rather than render a misleading blank.
 */
export function useGitBranch(workspaceId: string, rootPath: string | null): GitBranchStatus | null {
  const [, forceRerender] = useState(0)

  useEffect(() => {
    if (!rootPath) return
    let cancelled = false

    const subscriber = (): void => {
      if (!cancelled) forceRerender((n) => n + 1)
    }
    let set = listeners.get(rootPath)
    if (!set) {
      set = new Set()
      listeners.set(rootPath, set)
    }
    set.add(subscriber)

    // Kick off (or piggyback on) a fetch for this rootPath.
    void fetchBranch(workspaceId, rootPath)

    // Refcounted shared poller: only the first subscriber for a rootPath
    // creates the setInterval; subsequent ones piggyback. The last to leave
    // tears it down. This keeps the actual git-spawn count at O(unique
    // rootPaths), not O(panes).
    const existing = pollers.get(rootPath)
    if (existing) {
      existing.subscribers += 1
    } else {
      const intervalId = window.setInterval(() => {
        const poller = pollers.get(rootPath)
        if (poller) void fetchBranch(poller.workspaceId, rootPath)
      }, REFRESH_INTERVAL_MS)
      pollers.set(rootPath, { intervalId, subscribers: 1, workspaceId })
    }

    return () => {
      cancelled = true
      set!.delete(subscriber)
      if (set!.size === 0) listeners.delete(rootPath)
      const poller = pollers.get(rootPath)
      if (poller) {
        poller.subscribers -= 1
        if (poller.subscribers <= 0) {
          window.clearInterval(poller.intervalId)
          pollers.delete(rootPath)
        }
      }
    }
  }, [workspaceId, rootPath])

  if (!rootPath) return null
  return cache.get(rootPath)?.status ?? null
}

/**
 * Imperatively bust the in-memory cache for a rootPath. Useful after the
 * user explicitly checks out a different branch via the worktree menu so the
 * UI snaps to the new value without waiting 10s.
 */
export function invalidateGitBranch(rootPath: string): void {
  cache.delete(rootPath)
  notify(rootPath)
}

/** Test-only: clear all cached branches between tests. */
export function __resetGitBranchCacheForTests(): void {
  cache.clear()
  listeners.clear()
  loggedFailures.clear()
  for (const poller of pollers.values()) window.clearInterval(poller.intervalId)
  pollers.clear()
}
