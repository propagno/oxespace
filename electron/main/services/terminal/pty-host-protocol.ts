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

export type PtyHostEvent =
  | { t: 'ready'; pid: number }
  | { t: 'spawned'; id: number; pid: number; process: string }
  | { t: 'spawn-failed'; id: number; message: string }
  | { t: 'data'; id: number; data: string }
  /** The terminal's foreground process name, when it changed (node-pty's `process`). */
  | { t: 'process'; id: number; process: string }
  | { t: 'exit'; id: number; exitCode: number; signal?: number }

/** The environment switch: unset (the default) keeps node-pty in the main process. */
export const PTY_HOST_ENV = 'OXESPACE_PTY_HOST'

/** The exit code a terminal reports when its host process ended under it (crash, kill, quit). */
export const HOST_GONE_EXIT_CODE = 1
