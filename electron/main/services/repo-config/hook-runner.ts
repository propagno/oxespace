/**
 * Runs a repo hook headless. The deadline is owned here rather than delegated
 * to `exec({timeout})`: a hook that traps SIGTERM and then exits 0 must not be
 * reported as a pass, so a timeout always settles as "no exit code".
 */
import { spawn, type ChildProcess } from 'node:child_process'

export const HOOK_TIMEOUT_MS = 120_000
const KILL_GRACE_MS = 2_000
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024

export type HookOutcome =
  | { status: 'passed'; output: string }
  | { status: 'failed'; exitCode: number; output: string }
  /** Timed out, killed by signal or failed to spawn: whether it succeeded is unknown. */
  | { status: 'unverifiable'; reason: 'timeout' | 'signal' | 'spawn-error'; output: string }

export interface RunHookOptions {
  cwd: string
  env?: Record<string, string>
  timeoutMs?: number
}

function createSink(): { push(chunk: Buffer): void; text(): string } {
  const parts: Buffer[] = []
  let size = 0
  let truncated = false
  return {
    push(chunk) {
      if (size >= MAX_OUTPUT_BYTES) {
        truncated = true
        return
      }
      const room = MAX_OUTPUT_BYTES - size
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk
      if (slice.length < chunk.length) truncated = true
      parts.push(slice)
      size += slice.length
    },
    text() {
      return Buffer.concat(parts).toString('utf8') + (truncated ? '\n[output truncated]' : '')
    }
  }
}

function terminateTree(child: ChildProcess, force: boolean): void {
  const pid = child.pid
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      const args = ['/pid', String(pid), '/t']
      if (force) args.push('/f')
      spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
    } else {
      process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM')
    }
  } catch {
    try {
      child.kill(force ? 'SIGKILL' : 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

export function runHook(script: string, options: RunHookOptions): Promise<HookOutcome> {
  const timeoutMs = options.timeoutMs ?? HOOK_TIMEOUT_MS
  const isWindows = process.platform === 'win32'
  return new Promise((resolve) => {
    const out = createSink()
    const err = createSink()
    const output = (): string => [out.text(), err.text()].filter(Boolean).join('\n')
    let settled = false
    const settle = (outcome: HookOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(outcome)
    }

    let child: ChildProcess
    try {
      child = spawn(script, {
        cwd: options.cwd,
        shell: isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/bash',
        windowsHide: true,
        detached: !isWindows,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          ...options.env
        }
      })
    } catch {
      resolve({ status: 'unverifiable', reason: 'spawn-error', output: '' })
      return
    }

    // Stream errors must be swallowed: an unhandled one would take down main.
    child.stdout?.on('data', (c: Buffer) => out.push(c)).on('error', () => undefined)
    child.stderr?.on('data', (c: Buffer) => err.push(c)).on('error', () => undefined)

    const deadline = setTimeout(() => {
      settle({ status: 'unverifiable', reason: 'timeout', output: output() })
      terminateTree(child, false)
      setTimeout(() => terminateTree(child, true), KILL_GRACE_MS).unref()
    }, timeoutMs)

    child.on('error', () => settle({ status: 'unverifiable', reason: 'spawn-error', output: output() }))
    child.on('close', (code, signal) => {
      if (code === null || signal) settle({ status: 'unverifiable', reason: 'signal', output: output() })
      else if (code === 0) settle({ status: 'passed', output: output() })
      else settle({ status: 'failed', exitCode: code, output: output() })
    })
  })
}
