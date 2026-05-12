import { create } from 'zustand'

export type TerminalPaneStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

interface TerminalStateEntry {
  status: TerminalPaneStatus
  error: string | null
  lastActivityAt: number | null
  lastOutput: string | null
  isWorking: boolean
  hasUnread: boolean
}

interface TerminalState {
  panes: Record<string, TerminalStateEntry>
  pendingCommands: Record<string, string>
  setStatus: (paneId: string, status: TerminalPaneStatus, error?: string | null) => void
  getStatus: (paneId: string) => TerminalStateEntry
  updateActivity: (paneId: string, rawData: string) => void
  updatePreview: (paneId: string, preview: string) => void
  markRead: (paneId: string) => void
  setPendingCommand: (paneId: string, command: string) => void
  consumePendingCommand: (paneId: string) => string | null
}

const DEFAULT_STATE: TerminalStateEntry = {
  status: 'idle',
  error: null,
  lastActivityAt: null,
  lastOutput: null,
  isWorking: false,
  hasUnread: false
}

function stripAnsi(str: string): string {
  return str
    .replace(/\x1B\[[\x3C-\x3F]*[\d;]*[\x20-\x2F]*[\x40-\x7E]/g, '') // CSI (incl. ?/>/<)
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')                // OSC
    .replace(/\x1B[PX^_][^\x1B]*\x1B\\/g, '')                         // DCS/SOS/PM/APC
    .replace(/\x1B[@-_]/g, '')                                          // Fe two-char
    .replace(/\x1B[()][AB012]/g, '')                                    // charset
    .replace(/\r/g, '')
}

// Module-level timers so they survive re-renders
const workingTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useTerminalStore = create<TerminalState>((set, get) => ({
  panes: {},
  pendingCommands: {},

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

  updateActivity: (paneId, rawData) => {
    const stripped = stripAnsi(rawData)
    const lastLine = stripped.split('\n').map(l => l.trim()).filter(Boolean).at(-1) ?? null
    if (!lastLine) return

    set(state => ({
      panes: {
        ...state.panes,
        [paneId]: {
          ...(state.panes[paneId] ?? DEFAULT_STATE),
          lastActivityAt: Date.now(),
          lastOutput: lastLine.slice(0, 80),
          isWorking: true,
          hasUnread: true
        }
      }
    }))

    // Reset isWorking after 1.5s of silence
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

  updatePreview: (paneId, preview) =>
    set(state => ({
      panes: {
        ...state.panes,
        [paneId]: { ...(state.panes[paneId] ?? DEFAULT_STATE), lastOutput: preview }
      }
    })),

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
