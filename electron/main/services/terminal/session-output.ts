import type { IPty } from 'node-pty'
import type { TerminalActivityEvent, TerminalAttachInput, TerminalAttachResult, TerminalDataEvent, TerminalDetachInput, TerminalDetachResult } from '../../../../shared/types/ipc'
import type { ResumableAgent } from '../agent-state/pane-sessions'
import type { PtyInputQueue } from '../pty-input-queue'
import type { PtyOutputBatcher } from '../pty-output-batcher'
import type { PtyRingBuffer } from '../pty-ring-buffer'
import type { PtyModeTracker } from '../pty-mode-tracker'
import { DA1_CARRY_MS, DA1_REPLY, stripDa1, type Da1Filter } from '../pty-da1'
import { PtyFlowControl } from '../../workers/ptyFlowControl'

interface FlowControlHostedPty extends IPty {
  ackData(chars: number): void
}

function isFlowControlHostedPty(pty: IPty): pty is FlowControlHostedPty {
  return typeof (pty as Partial<FlowControlHostedPty>).ackData === 'function'
}

/** What the system ConPTY wrote first: clear, reset attributes, home. The bundled one writes none of it (B13). */
export const CONPTY_START_SCREEN = '\x1b[2J\x1b[m\x1b[H'

const ACTIVITY_THROTTLE_MS = 1000

export interface TerminalSession {
  sessionId: string
  launchDirectory: string
  executable: string
  startedAt: number
  paneId: string
  workspaceId: string
  pty: IPty
  agentCommand?: string
  /** Whether the start that made this process wanted the agent's session back (a restart asks the same). */
  resumeAgent?: boolean
  /** B17 · The native session this process was started to resume, if any. */
  resumed?: { agent: ResumableAgent; sessionId: string }
  /** OXE-467 · Resumable AI CLI started interactively inside a shell pane (e.g. typing `agy`, `claude`, `codex`). */
  detectedAgent?: ResumableAgent
  revokeProxy?: () => void
  inputQueue: PtyInputQueue
  outputBatcher: PtyOutputBatcher
  /** Recent output, so a re-mounted view is restored without a respawn. */
  ring: PtyRingBuffer
  /** DEC private modes, so a re-mounted view lands in the right screen. */
  modes: PtyModeTracker
  /** True while a terminal view is rendering this session. */
  attached: boolean
  /**
   * True only between a view's attach() and its detach(). `attached` starts true so the first prompt is not held
   * back, but a pane started with no view never attaches; then main answers DA1 itself (see pty-da1.ts).
   */
  viewAttached: boolean
  /**
   * OXE-411 · Detached by a view that is still mounted (its workspace is hidden) and will attach again: not a session
   * without a view (the status bar count) and never reclaimed as idle.
   */
  parked?: boolean
  /**
   * OXE-436 / OXE-443 · Set when `attach()` needs the post-attach same-size resize handshake to nudge
   * a clean full-viewport redraw (fresh/truncated `altScreen` or truncated normal-buffer inline TUI).
   */
  pendingRedrawNudge?: boolean
  /** OXE-443 · Active bounce-restore timer from `nudgeRedraw`, cancelled on new resize, detach, or stop. */
  nudgeTimer?: ReturnType<typeof setTimeout> | null
  da1: Da1Filter
  da1Timer: ReturnType<typeof setTimeout> | null
  /** OXE-483 · Local flow-control watermark tracker used when node-pty runs in-process (non-HostedPty). */
  flowControl?: PtyFlowControl
  lastActivityAt: number
  /** Last size the view reported; used for the alt-screen redraw nudge. */
  cols: number
  rows: number
  activityNotifiedAt: number
}

/**
 * A session whose process died while no view was attached. Without this the
 * pane would come back as a fresh shell and the user would never see why their
 * agent stopped.
 */
export interface ExitedSession {
  exitCode: number | null
  exitedAt: number
  ring: PtyRingBuffer
  modes: PtyModeTracker
}

export interface SessionOutputHost {
  sessions: ReadonlyMap<string, TerminalSession>
  takeExited: (paneId: string) => ExitedSession | undefined
  scanShellCwd: (paneId: string, chunk: string) => void
  emitData: (event: TerminalDataEvent) => void
  emitActivity: (event: TerminalActivityEvent) => void
}

/** The output path: from the PTY to the ring, the attached view and the readers that are not views. */
export class SessionOutput {
  private readonly outputListeners = new Set<(paneId: string) => void>()

  constructor(private readonly host: SessionOutputHost) {}

  /**
   * PTY output on its way to the batcher. A DA1 query that no view will answer is answered here and removed from the
   * stream. Main runs this and attach()/detach() on one thread, so the choice is made once per query and holds:
   * - no view at that moment: the query never reaches the ring or the IPC stream, so a view attaching while main's
   *   reply is still queued (or any later replay) cannot answer it a second time;
   * - a view attached: the query goes to it live and its xterm answers; main sends nothing. detach() flushes the
   *   batcher first, so the view still gets it; a view torn down before parsing it leaves ConPTY to time out, never
   *   two replies.
   */
  receive(session: TerminalSession, chunk: string): void {
    this.host.scanShellCwd(session.paneId, chunk)
    if (!isFlowControlHostedPty(session.pty)) session.flowControl?.onData(chunk.length)
    const { data, answered } = session.da1.filter(chunk, !session.viewAttached)
    for (let i = 0; i < answered; i++) void session.inputQueue.enqueue(DA1_REPLY)
    if (data) session.outputBatcher.push(data)
    if (session.da1Timer) { clearTimeout(session.da1Timer); session.da1Timer = null }
    if (session.da1.holding) {
      session.da1Timer = setTimeout(() => {
        session.da1Timer = null
        if (this.host.sessions.get(session.paneId) === session) session.outputBatcher.push(session.da1.release())
      }, DA1_CARRY_MS)
    }
  }

  releaseDa1(session: TerminalSession): void {
    if (session.da1Timer) { clearTimeout(session.da1Timer); session.da1Timer = null }
    const held = session.da1.release()
    if (held) session.outputBatcher.push(held)
  }

  /** Releases pending DA1 state and disposes any local flow-control timers on exit/stop. */
  cleanup(session: TerminalSession): void {
    this.releaseDa1(session)
    session.flowControl?.dispose()
    session.flowControl = undefined
  }

  /** Forward renderer xterm parse acknowledgement for end-to-end node-pty backpressure (OXE-483). */
  ack(paneId: string, chars: number): void {
    const session = this.host.sessions.get(paneId)
    if (!session || !Number.isFinite(chars) || chars <= 0) return
    if (isFlowControlHostedPty(session.pty)) session.pty.ackData(chars)
    else session.flowControl?.ack(chars)
  }

  /**
   * Route batched output. Everything is retained; only an attached view gets
   * the bytes over IPC. Previously every chunk was broadcast to every window
   * and dropped in the preload when nobody was listening.
   */
  onBatch(event: TerminalDataEvent): void {
    const session = this.host.sessions.get(event.paneId)
    if (!session) return

    // A replayed DA1 would be answered again by the re-mounted view and typed into the shell as `?1;2c`. Whoever was
    // going to answer it has (main or the live view), so the ring keeps none. receive() never splits a query.
    session.ring.push(stripDa1(event.data))
    session.modes.consume(event.data)
    session.lastActivityAt = Date.now()
    for (const listener of this.outputListeners) { try { listener(event.paneId) } catch { /* a reader never breaks the pane */ } }

    if (session.attached) {
      this.host.emitData(event)
      return
    }

    // Detached: no payload crosses the boundary, but the UI still needs to know
    // a background agent is working (sidebar dots, notifications).
    if (session.lastActivityAt - session.activityNotifiedAt < ACTIVITY_THROTTLE_MS) return
    session.activityNotifiedAt = session.lastActivityAt
    this.host.emitActivity({ paneId: event.paneId, at: session.lastActivityAt, bytes: event.data.length })
  }

  /**
   * Bind a terminal view to a session and hand back what it needs to render.
   *
   * Ordering matters: the caller subscribes to `onData` BEFORE calling this,
   * queueing what arrives. This body runs in one synchronous tick — flush,
   * read the ring, mark attached — so no chunk can slip between the snapshot
   * and the live stream, and none is delivered twice.
   */
  attach(input: TerminalAttachInput): TerminalAttachResult {
    const session = this.host.sessions.get(input.paneId)
    if (!session) {
      const exited = this.host.takeExited(input.paneId)
      if (!exited) {
        return { running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false }
      }
      return {
        running: false,
        seq: exited.ring.seq,
        prologue: exited.modes.prologue(),
        replay: exited.ring.snapshot(),
        truncated: false,
        altScreen: false,
        exit: { exitCode: exited.exitCode, at: exited.exitedAt }
      }
    }

    session.outputBatcher.flush()
    const slice = session.ring.since(input.sinceSeq ?? 0)
    session.attached = true
    session.viewAttached = true
    session.parked = false
    if (isFlowControlHostedPty(session.pty)) {
      session.pty.handleFlowControl = true
    } else {
      session.flowControl ??= new PtyFlowControl(session.pty, { attached: false })
      session.flowControl.setAttached(true)
    }

    // On a fresh or overflowed alt-screen attach, retained bytes cannot be trusted because `\x1b[?1049h`
    // may have been evicted; ask the app for a clean repaint instead. On a contiguous Lever H delta reattach
    // (`sinceSeq` without overflow), the view is already mounted in the right screen and receives the exact delta.
    const altScreen = session.modes.altScreen
    const hasContiguousDelta = input.sinceSeq !== undefined && !slice.truncated
    const truncated = slice.truncated || (input.sinceSeq === undefined && session.ring.evicted)
    session.pendingRedrawNudge = truncated || (altScreen && !hasContiguousDelta)
    return {
      running: true,
      seq: session.ring.seq,
      prologue: session.modes.prologue(),
      replay: altScreen && !hasContiguousDelta ? '' : slice.data,
      truncated,
      altScreen
    }
  }

  /**
   * Main-process readers that are not views (the remote gateway) hear that a pane printed something, then read it
   * with `readSince`. Nothing is attached, so the pane and its views are unaffected.
   */
  onOutput(listener: (paneId: string) => void): () => void {
    this.outputListeners.add(listener)
    return () => { this.outputListeners.delete(listener) }
  }

  /** Output after `seq` in the ring, without attaching. `session` changes when the pane's process is replaced. */
  readSince(paneId: string, seq: number): { session: string; seq: number; data: string; truncated: boolean; cols: number; rows: number } | null {
    const session = this.host.sessions.get(paneId)
    if (!session) return null
    session.outputBatcher.flush()
    return { session: session.sessionId, seq: session.ring.seq, cols: session.cols, rows: session.rows, ...session.ring.since(seq) }
  }

  /**
   * Unbind the view. The process keeps running and its output keeps accruing. Returns the ring's cursor, so a parked
   * view (OXE-411) attaches again with `sinceSeq` and gets only what came after.
   */
  detach(input: TerminalDetachInput): TerminalDetachResult | undefined {
    const session = this.host.sessions.get(input.paneId)
    if (!session) return undefined
    session.outputBatcher.flush()
    session.attached = false
    session.viewAttached = false
    session.parked = input.parked === true
    if (isFlowControlHostedPty(session.pty)) {
      session.pty.handleFlowControl = false
    } else {
      session.flowControl?.setAttached(false)
    }
    session.pendingRedrawNudge = false
    if (session.nudgeTimer) {
      clearTimeout(session.nudgeTimer)
      session.nudgeTimer = null
    }
    return { seq: session.ring.seq }
  }

  /**
   * The retained output for a reader that is not a view (an agent through MCP).
   * Nothing is attached or consumed, so the pane and its views are unaffected.
   */
  peek(paneId: string): { running: boolean; data: string; altScreen: boolean } | null {
    const session = this.host.sessions.get(paneId)
    if (!session) return null
    return { running: true, data: session.ring.snapshot(), altScreen: session.modes.altScreen }
  }
}
