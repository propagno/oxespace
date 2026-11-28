/**
 * OXE-400 · The messages between the main process and the PTY host (electron/main/workers/pty-host.ts), the
 * utility process that runs node-pty when OXESPACE_PTY_HOST=utility. One host serves every terminal; each terminal
 * is a session id the main process picks. Messages keep their order on the port, so a write sent after a spawn
 * always finds its session.
 */
import type { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'

export type PtyHostRequest =
  | { t: 'spawn'; id: number; file: string; args: string[]; options: IPtyForkOptions | IWindowsPtyForkOptions }
  | { t: 'write'; id: number; data: string }
  | { t: 'resize'; id: number; cols: number; rows: number }
  | { t: 'kill'; id: number; signal?: string }
  | { t: 'clear'; id: number }
  | { t: 'pause'; id: number }
  | { t: 'resume'; id: number }
  | { t: 'ack'; id: number; chars: number }
  | { t: 'flow-control'; id: number; enabled: boolean }
  | { t: 'bind-pane'; id: number; paneId: string }
  | { t: 'direct-route'; id: number; paneId: string; enabled: boolean }
  | { t: 'attach-renderer-port'; windowId: number }
  | { t: 'detach-renderer-port'; windowId: number }

export type PtyHostEvent =
  | { t: 'ready'; pid: number }
  | { t: 'spawned'; id: number; pid: number; process: string }
  | { t: 'spawn-failed'; id: number; message: string }
  | { t: 'data'; id: number; data: string; seq?: number; direct?: boolean }
  /** The terminal's foreground process name, when it changed (node-pty's `process`). */
  | { t: 'process'; id: number; process: string }
  | { t: 'exit'; id: number; exitCode: number; signal?: number }

/** OXE-488 · Direct MessagePort frames from pty-host utility process to Renderer preload (1 hop). */
export type PtyDirectToRendererMessage =
  | { t: 'data'; paneId: string; ptyId: number; seq: number; data: string }
  | { t: 'bound'; paneId: string; ptyId: number; enabled: boolean }

/** OXE-488 · Direct MessagePort frames from Renderer preload back to pty-host utility process (1 hop). */
export type PtyDirectFromRendererMessage =
  | { t: 'ack'; paneId: string; chars: number }

/** The environment switch. The PTY host is the default since OXE-400 (23/11, the user's decision after the proof). */
export const PTY_HOST_ENV = 'OXESPACE_PTY_HOST'

export type PtyHostMode = 'utility' | 'main' | 'daemon'

/** Where node-pty runs: the PTY host utility process by default, `main` in-process, or `daemon` detached. */
export function ptyHostMode(env: NodeJS.ProcessEnv = process.env): PtyHostMode {
  const value = env[PTY_HOST_ENV]?.trim().toLowerCase()
  if (value === 'main') return 'main'
  if (value === 'daemon') return 'daemon'
  return 'utility'
}

/** The exit code a terminal reports when its host process ended under it (crash, kill, quit). */
export const HOST_GONE_EXIT_CODE = 1
