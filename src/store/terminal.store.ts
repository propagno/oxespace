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
// One-shot timers that decay the 'awaiting' tone to 'idle'. deriveStatusTone is
// pure (computed in render), so without a re-render at the window boundary the
// teal "your turn" dot would linger past its 5-minute life. Must match the
// window in paneDisplay.ts deriveStatusTone.
const awaitingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const AWAITING_WINDOW_MS = 5 * 60_000

function clearAwaitingTimer(paneId: string): void {
  const t = awaitingTimers.get(paneId)
  if (t) { clearTimeout(t); awaitingTimers.delete(paneId) }
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  panes: {},
  pendingCommands: {},
  activePaneId: null,

  setStatus: (paneId, status, error = null) => {
    // A status change recomputes the tone immediately → cancel any pending
    // awaiting-decay so a stale timer can't bump an unrelated later state.
    clearAwaitingTimer(paneId)
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
    }))
  },

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
    // stripTerminalControl is needed on every chunk because `hasOutput` gates
    // the isWorking timer reset below. The pricier sanitizeTerminalPreview pass,
    // however, only feeds the throttled set() — so we defer it behind the 100ms
    // gate. During agent streaming (dozens of chunks/s × up to 16 panes) ~9 of
    // 10 chunks are throttled, so this skips that second regex on most of them.
    const stripped = stripTerminalControl(rawData)
    const hasOutput = /\S/.test(stripped) // any non-whitespace char (no array alloc)
    if (!hasOutput) return

    const now = Date.now()
    const lastTime = lastActivitySetTime.get(paneId) ?? 0
    if (now - lastTime >= 100) {
      lastActivitySetTime.set(paneId, now)
      const preview = sanitizeTerminalPreview(rawData)
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

    // Always reset isWorking timer regardless of throttle. New output also
    // resets any pending awaiting-decay — the window restarts from this touch.
    const existing = workingTimers.get(paneId)
    if (existing) clearTimeout(existing)
    clearAwaitingTimer(paneId)
    workingTimers.set(paneId, setTimeout(() => {
      workingTimers.delete(paneId)
      set(state => ({
        panes: {
          ...state.panes,
          [paneId]: { ...(state.panes[paneId] ?? DEFAULT_STATE), isWorking: false }
        }
      }))
      // Streaming stopped → the pane is now 'awaiting' (if running + has intent).
      // Schedule a no-op refresh at the window boundary so the tone decays to
      // 'idle' on its own. The fresh entry reference forces a re-render.
      awaitingTimers.set(paneId, setTimeout(() => {
        awaitingTimers.delete(paneId)
        set(state => {
          const entry = state.panes[paneId]
          if (!entry) return state
          return { panes: { ...state.panes, [paneId]: { ...entry } } }
        })
      }, AWAITING_WINDOW_MS))
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
