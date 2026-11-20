import { deriveStatusOrigin, deriveStatusTone } from '../utils/paneDisplay'
import { useActivityStore, type LiveAttention } from './activity.store'
import { useTerminalStore } from './terminal.store'
import { useThreadStore } from './thread.store'
import { useWorkspaceStore } from './workspace.store'

/**
 * Keeps the activity store's live attention in step with the terminal and Thread stores, synchronously,
 * so the mode switch badge reads one source and still changes in the same render as the state it counts.
 */
function codeLive(): Record<string, LiveAttention> {
  const entries: Record<string, LiveAttention> = {}
  const panes = useTerminalStore.getState().panes
  for (const workspace of useWorkspaceStore.getState().workspaces) {
    for (const pane of workspace.panes) {
      if (pane.type !== 'terminal') continue
      const entry = panes[pane.id]
      if (!entry) continue
      const tone = deriveStatusTone(entry)
      // Only an agent stopped on an approval or a question needs a person; a finished turn is news, not a request
      // (it stays visible on its pane and row, and in the activity center).
      if (tone === 'needs-decision') entries[pane.id] = 'needs-you'
      else if (tone === 'error') entries[pane.id] = 'failed'
      // "N agents working" counts agents: a plain shell running a build or a server is busy, and is not one. A pane
      // is an agent's when it was given one, or when what runs in it reports its own state (an agent started by hand).
      else if (tone === 'thinking' && (pane.agentProfileId || pane.agentName || (entry.agentState && entry.agentState !== 'unknown') || deriveStatusOrigin(entry) === 'hook')) entries[pane.id] = 'working'
    }
  }
  return entries
}

function threadLive(): Record<string, LiveAttention> {
  const entries: Record<string, LiveAttention> = {}
  const { threads, unreadIds } = useThreadStore.getState()
  for (const thread of threads) {
    if (thread.status === 'approval') entries[thread.id] = 'needs-you'
    // A failure counts until the person opens that conversation; one already seen stays in the list, not on the rail.
    else if (thread.status === 'failed' && unreadIds.includes(thread.id)) entries[thread.id] = 'failed'
    else if (thread.status === 'running') entries[thread.id] = 'working'
  }
  return entries
}

let connected = false
let syncAll: (() => void) | null = null
let pendingSummary: Promise<void> | null = null
let pendingGeneration = 0

/** Idempotent; the subscriptions live as long as the stores do. */
export function connectAttentionFeed(): void {
  if (connected) return
  connected = true
  const syncCode = (): void => useActivityStore.getState().setLive('code', codeLive())
  const syncThread = (): void => useActivityStore.getState().setLive('thread', threadLive())
  syncAll = () => { syncCode(); syncThread() }
  useTerminalStore.subscribe((state, previous) => { if (state.panes !== previous.panes) syncCode() })
  useWorkspaceStore.subscribe((state, previous) => { if (state.workspaces !== previous.workspaces) syncCode() })
  useThreadStore.subscribe((state, previous) => { if (state.threads !== previous.threads || state.unreadIds !== previous.unreadIds) syncThread() })
  syncAll()
}

/**
 * Registers an in-flight startup load that feeds the attention summary (OXE-287).
 * While it is pending, `NextAttentionHost` waits for it instead of dropping or
 * answering early on the first `Ctrl+Shift+U` press; failure still settles ready.
 */
export function registerAttentionSummaryLoad(load: Promise<unknown>): void {
  const gen = ++pendingGeneration
  const previous = pendingSummary
  const combined = Promise.all([
    previous ?? Promise.resolve(),
    Promise.resolve(load).catch(() => undefined)
  ]).then(() => {
    if (gen === pendingGeneration) {
      pendingSummary = null
      syncAll?.()
    }
  })
  pendingSummary = combined
}

/** True when no startup attention summary load is currently in flight. */
export function isAttentionSummaryReady(): boolean {
  return pendingSummary === null
}

/** Resolves once the startup attention summary load settles, or after `timeoutMs` so a stalled source never hangs Ctrl+Shift+U. */
export function whenAttentionSummaryReady(timeoutMs = 3_000): Promise<void> {
  const current = pendingSummary
  if (!current) return Promise.resolve()
  if (timeoutMs <= 0) return current
  return new Promise<void>(resolve => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    void current.then(finish, finish)
  })
}

/** Test-only helper to clear any registered startup summary load between cases. */
export function resetAttentionSummaryLoadForTests(): void {
  pendingGeneration += 1
  pendingSummary = null
}
