import { create } from 'zustand'
import { sanitizeTerminalPreview, stripTerminalControl } from '../utils/paneDisplay'

export type TerminalPaneStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

export interface TerminalStateEntry {
  status: TerminalPaneStatus
  error: string | null
  lastActivityAt: number | null
  lastOutput: string | null
  /** Last full line the user typed in this pane (committed on Enter). */
  lastIntent: string | null
  /** Wall-clock when `lastIntent` was committed, used to derive 'awaiting' state. */
  lastIntentAt: number | null
  isWorking: boolean
  hasUnread: boolean
}

interface TerminalState {
  panes: Record<string, TerminalStateEntry>
  pendingCommands: Record<string, string>
  activePaneId: string | null
  setStatus: (paneId: string, status: TerminalPaneStatus, error?: string | null) => void
  setActivePaneId: (paneId: string | null) => void
  getStatus: (paneId: string) => TerminalStateEntry
  updateActivity: (paneId: string, rawData: string) => void
  updatePreview: (paneId: string, preview: string) => void
  /** Record the user's most recent committed (Enter-terminated) input. */
  setLastIntent: (paneId: string, intent: string) => void
  markRead: (paneId: string) => void
  setPendingCommand: (paneId: string, command: string) => void
  consumePendingCommand: (paneId: string) => string | null
}

const DEFAULT_STATE: TerminalStateEntry = {
  status: 'idle',
  error: null,
  lastActivityAt: null,
  lastOutput: null,
  lastIntent: null,
  lastIntentAt: null,
  isWorking: false,
  hasUnread: false
}

// Module-level timers so they survive re-renders
const workingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lastActivitySetTime = new Map<string, number>()

export const useTerminalStore = create<TerminalState>((set, get) => ({
  panes: {},
  pendingCommands: {},
  activePaneId: null,

  setStatus: (paneId, status, error = null) =>
    set((state) => ({
      panes: {
        ...state.panes,
        [paneId]: {
          ...(state.panes[paneId] ?? DEFAULT_STATE),
          status,
          error,
          isWorking: status !== 'running' ? false : (state.panes[paneId]?.isWorking ?? false)
        }
      }
    })),

  getStatus: (paneId) => get().panes[paneId] ?? DEFAULT_STATE,

  setActivePaneId: (paneId) => {
    set((state) => {
      if (state.activePaneId === paneId) return state
      const nextPanes = paneId && state.panes[paneId]?.hasUnread
        ? {
            ...state.panes,
            [paneId]: { ...state.panes[paneId], hasUnread: false }
          }
        : state.panes
      return { activePaneId: paneId, panes: nextPanes }
    })
  },

  updateActivity: (paneId, rawData) => {
    const stripped = stripTerminalControl(rawData)
    const hasOutput = stripped.split('\n').some((line) => line.trim().length > 0)
    if (!hasOutput) return
    const preview = sanitizeTerminalPreview(rawData)

    const now = Date.now()
    const lastTime = lastActivitySetTime.get(paneId) ?? 0
    if (now - lastTime >= 100) {
      lastActivitySetTime.set(paneId, now)
      set(state => ({
        panes: {
          ...state.panes,
          [paneId]: {
            ...(state.panes[paneId] ?? DEFAULT_STATE),
            lastActivityAt: now,
            lastOutput: preview ?? state.panes[paneId]?.lastOutput ?? null,
            isWorking: true,
            hasUnread: state.activePaneId === paneId ? false : true
          }
        }
      }))
    }

    // Always reset isWorking timer regardless of throttle
    const existing = workingTimers.get(paneId)
    if (existing) clearTimeout(existing)
    workingTimers.set(paneId, setTimeout(() => {
      workingTimers.delete(paneId)
      set(state => ({
        panes: {
          ...state.panes,
          [paneId]: { ...(state.panes[paneId] ?? DEFAULT_STATE), isWorking: false }
        }
      }))
    }, 1500))
  },

  updatePreview: (paneId, preview) => {
    const sanitized = sanitizeTerminalPreview(preview)
    if (!sanitized) return
    set(state => ({
      panes: {
        ...state.panes,
        [paneId]: { ...(state.panes[paneId] ?? DEFAULT_STATE), lastOutput: sanitized }
      }
    }))
  },

  setLastIntent: (paneId, intent) => {
    const trimmed = intent.trim()
    if (!trimmed) return
    set(state => ({
      panes: {
        ...state.panes,
        [paneId]: {
          ...(state.panes[paneId] ?? DEFAULT_STATE),
          // Cap at 120 chars so a long prompt doesn't blow up the sidebar/header.
          // The full input still went to the PTY — this is just the display tag.
          lastIntent: trimmed.length > 120 ? trimmed.slice(0, 117) + '…' : trimmed,
          lastIntentAt: Date.now()
        }
      }
    }))
  },

  markRead: (paneId) =>
    set(state => ({
      panes: {
        ...state.panes,
        [paneId]: { ...(state.panes[paneId] ?? DEFAULT_STATE), hasUnread: false }
      }
    })),

  setPendingCommand: (paneId, command) =>
    set((state) => ({
      pendingCommands: { ...state.pendingCommands, [paneId]: command }
    })),

  consumePendingCommand: (paneId) => {
    const cmd = get().pendingCommands[paneId] ?? null
    if (cmd !== null) {
      set((state) => {
        const { [paneId]: _, ...rest } = state.pendingCommands
        return { pendingCommands: rest }
      })
    }
    return cmd
  }
}))

/**
 * Three-tier activity level for vibe-coding awareness:
 * - `thinking`: agent is streaming output right now (isWorking timer alive).
 * - `awaiting`: agent paused after the user's last intent (recent activity,
 *   running status, has an intent on record). Visually = "check me".
 * - `idle`: everything else — never started, exited, or no recent activity.
 *
 * Pure function so it can be called inside selectors without re-render churn.
 */
export type ActivityLevel = 'thinking' | 'awaiting' | 'idle'
export function deriveActivityLevel(entry: TerminalStateEntry | undefined): ActivityLevel {
  if (!entry) return 'idle'
  if (entry.isWorking) return 'thinking'
  const isRunning = entry.status === 'running' || entry.status === 'starting'
  if (!isRunning) return 'idle'
  // "Awaiting" is the post-response window where the user typed something
  // recently and the agent already finished printing. Five minutes feels
  // about right for a vibe-coding cadence — long enough to read a long
  // answer, short enough to not stay marked as "needs attention" forever.
  const hasFreshIntent = entry.lastIntent !== null
  const lastTouchMs = Math.max(entry.lastActivityAt ?? 0, entry.lastIntentAt ?? 0)
  if (hasFreshIntent && lastTouchMs && Date.now() - lastTouchMs < 5 * 60_000) {
    return 'awaiting'
  }
  return 'idle'
}
