/** Terminal and pane inputs, events and results that cross the IPC boundary. Re-exported by `../ipc`. */
import type { PaneType } from '../workspace'
import type { MainMessage } from '../../messages'

export interface TerminalStartInput {
  paneId: string
  workspaceId: string
  agentCommand?: string
  agentArgs?: string[]
  initialPrompt?: string  /** On the pane's first start after the app opens, reopen the agent session its hooks recorded (Claude Code, Codex). */
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
  /**
   * B17 · terminal.restart only: `false` starts the pane fresh, without its agent's recorded session, and forgets that
   * session (agentResume becomes `notResumed` with `agents.resume.startedFresh`). Absent, a restart resumes as usual.
   */
  resume?: false
}

export interface TerminalDataEvent {
  paneId: string
  data: string
  /** OXE-488 · Utility PTY host session id (present when originating from pty-host). */
  ptyId?: number
  /** OXE-488 · Monotonic per-ptyId frame sequence for deduplication and cross-transport ordering. */
  seq?: number
}

/** OXE-488 · Internal Main -> Preload channel used to transfer the direct pty-host MessagePort. */
export const TERMINAL_PTY_PORT_CHANNEL = 'terminal:pty-port'

/** OXE-488 · Live transport diagnostics reported by the preload direct MessagePort bridge. */
export interface TerminalTransportStats {
  transport: 'message-port' | 'ipc-fallback'
  portConnected: boolean
  directFrames: number
  directBytes: number
  directAcks: number
  fallbackFrames: number
  fallbackBytes: number
  fallbackAcks: number
  dedupedFrames: number
  reorderedFrames: number
}

export interface TerminalExitEvent {
  paneId: string
  exitCode: number | null
}

/** OXE-272 · Command execution state reported by shells with OSC 633/133 integration. */
export interface ShellCommandState {
  running: boolean
  startedAt: number
  finishedAt?: number
  exitCode?: number
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
  /** Present when an OSC 633/133 command start/end transition arrived on this pane. */
  command?: ShellCommandState
}

/**
 * terminal:detach. `parked` (OXE-411): the view is still mounted, its workspace is hidden, and it will attach again with
 * the returned `seq`; the session is then neither counted as running without a view nor reclaimed when idle.
 */
export interface TerminalDetachInput {
  paneId: string
  parked?: boolean
}

export interface TerminalDetachResult {
  /** The ring's cursor at the detach: attaching with it as `sinceSeq` returns only what came after. */
  seq: number
  /** OXE-488 · Utility PTY host session id at detach time, when backed by pty-host. */
  ptyId?: number
  /** OXE-488 · Highest pty-host frame sequence already captured in the ring at detach time. */
  frameSeq?: number
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
  /** OXE-488 · Utility PTY host session id, when backed by pty-host. */
  ptyId?: number
  /** OXE-488 · Highest pty-host frame sequence already captured in the replay/ring at attach time. */
  frameSeq?: number
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
  /** OXE-272 · Latest shell command execution state from OSC 633/133, when the shell reported one. */
  command?: ShellCommandState
  /** B17 · What the pane's first start in this app run did with its agent's native session; absent before that start. */
  agentResume?: PaneAgentResume
  /**
   * B17 · The agent session the pane is in now, for Terminal details (S2): the native id, where OXESpace learned it, and
   * the command that reopens it, built in main. `notFound` (with a C3 reason) when the pane runs Claude Code or Codex
   * but no session was reported yet. Absent for a plain shell with no agent session recorded.
   */
  agentSession?: PaneAgentSession
}

/** Providers whose native sessions OXESpace tracks and resumes in OxeCode panes. */
export type PaneSessionAgent = 'claude' | 'codex' | 'antigravity'

/**
 * B17 / OXE-467 · Where the pane's agent session came from:
 * - `launch`: main started the provider on it (`--session-id`, `--resume`, `--conversation`, or a B17 resume);
 * - `hook`: the agent's status hook reported it;
 * - `discovered`: matched automatically from the provider's native session storage in this directory;
 * - `recorded`: remembered from an earlier app run.
 */
export type PaneAgentSessionSource = 'launch' | 'hook' | 'discovered' | 'recorded'

export type PaneAgentSession =
  | { agent: PaneSessionAgent; sessionId: string; source: PaneAgentSessionSource; resumeCommand: string }
  | { source: 'notFound'; message: MainMessage }

/**
 * B17 · The native session (Claude Code, Codex, Antigravity) a pane's first start after the app opened went back to:
 * `resumed` (main started the provider on it), `notResumed` (one was recorded for the pane, and `message` says why it
 * was not used, C3 `agents.resume.*`), or `nothingRecorded`.
 */
export type PaneAgentResume =
  /** `note` (T54): resumed, but without skipping permissions as the session had, since the setting is off. */
  | { outcome: 'resumed'; agent: PaneSessionAgent; sessionId: string; note?: MainMessage }
  | { outcome: 'notResumed'; agent: PaneSessionAgent; sessionId: string; message: MainMessage }
  | { outcome: 'nothingRecorded' }

export interface SplitPaneInput {
  paneId: string
  direction: 'vertical' | 'horizontal'
}

/** 1.5.0 · The grid a phone holds for a pane while it has the terminal open; the desktop's own size returns after. */
export interface TerminalSizeLease {
  cols: number
  rows: number
}

export interface TerminalSizeLeaseEvent {
  paneId: string
  lease: TerminalSizeLease | null
}

export interface UpdatePaneTypeInput {
  paneId: string
  type: PaneType
}

export interface UpdatePaneNameInput {
  paneId: string
  displayName: string | null
}

/** OXE-447 · Whether quitting OXESpace detaches from daemon PTY sessions or stops all terminals. */
export type TerminalQuitBehavior = 'detach' | 'kill'
