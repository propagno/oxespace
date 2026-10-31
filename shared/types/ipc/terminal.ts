/** Terminal and pane inputs, events and results that cross the IPC boundary. Re-exported by `../ipc`. */
import type { PaneType } from '../workspace'

export interface TerminalStartInput {
  paneId: string
  workspaceId: string
  agentCommand?: string
  agentArgs?: string[]
  initialPrompt?: string
  disableRtk?: boolean
  /** On the pane's first start after the app opens, reopen the agent session its hooks recorded (Claude Code, Codex). */
  resumeAgent?: boolean
  /**
   * Real viewport at spawn time. Without these the PTY starts at 80x24 and the
   * app reflows on the first resize, which the user sees as a flash.
   */
  cols?: number
  rows?: number
}

export interface TerminalWriteInput {
  paneId: string
  data: string
}

export interface TerminalResizeInput {
  paneId: string
  cols: number
  rows: number
}

export interface TerminalStopInput {
  paneId: string
}

export interface TerminalDataEvent {
  paneId: string
  data: string
}

export interface TerminalExitEvent {
  paneId: string
  exitCode: number | null
}

/**
 * Heartbeat for a session with no attached view. Carries no output — just
 * enough for the sidebar and notifications to keep showing that a background
 * agent is working. Throttled in main.
 */
export interface TerminalActivityEvent {
  paneId: string
  at: number
  bytes: number
}

export interface TerminalAttachInput {
  paneId: string
  /** Cursor from a previous attach; omit to receive the whole retained buffer. */
  sinceSeq?: number
}

export interface TerminalAttachResult {
  running: boolean
  /** Cursor to hand back on the next attach. */
  seq: number
  /** Mode-restoring sequences to write before anything else. */
  prologue: string
  /** Retained output to replay. Empty when `altScreen` is true. */
  replay: string
  /** Output the caller needed had already been evicted — clear before writing. */
  truncated: boolean
  /**
   * The session is on the alternate screen. Replaying bytes would paint TUI
   * content onto the normal buffer, so main triggers a resize-driven redraw
   * instead and `replay` is empty.
   */
  altScreen: boolean
  /** Present when the process died while detached, instead of a silent respawn. */
  exit?: { exitCode: number | null; at: number }
}

export interface TerminalStatusResult {
  running: boolean
  seq: number
  altScreen: boolean
  /** OXESpace PTY session identity, distinct from any provider conversation ID. */
  sessionId?: string
  launchDirectory?: string
  executable?: string
  pid?: number
  startedAt?: number
}

export interface SplitPaneInput {
  paneId: string
  direction: 'vertical' | 'horizontal'
}

export interface UpdatePaneTypeInput {
  paneId: string
  type: PaneType
}

export interface UpdatePaneNameInput {
  paneId: string
  displayName: string | null
}
