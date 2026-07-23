import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

/**
 * F3 · Execution host seam.
 *
 * Everything the runtime does to a workspace — run a command, read a file —
 * goes through this interface instead of touching `child_process`/`fs` directly.
 * Today the only implementation is local; the point of the seam is that a
 * remote (SSH) host can be dropped in later without the callers changing.
 */
export interface ExecResult {
  code: number
  stdout: string
  stderr: string
  /** True when the process was killed for exceeding `timeoutMs`. */
  timedOut: boolean
}

export interface ExecOptions {
  cwd: string
  env?: Record<string, string>
  timeoutMs?: number
  /** Stdout/stderr are capped so a runaway process can't exhaust memory. */
  maxOutputBytes?: number
}

export interface ExecutionHost {
  /** Stable id used in logs and, later, to pick between local/remote hosts. */
  readonly id: string
  readonly kind: 'local' | 'remote'
  exec(command: string, args: string[], options: ExecOptions): Promise<ExecResult>
  readTextFile(path: string): Promise<string>
  writeTextFile(path: string, content: string): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export class LocalExecutionHost implements ExecutionHost {
  readonly id = 'local'
  readonly kind = 'local' as const

  async exec(command: string, args: string[], options: ExecOptions): Promise<ExecResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

    return new Promise<ExecResult>((resolve) => {
      // shell:false — arguments are passed as an array, so nothing in `args`
      // can be reinterpreted as shell syntax.
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        shell: false,
        windowsHide: true
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, timeoutMs)

      const append = (current: string, chunk: Buffer): string =>
        current.length >= maxBytes ? current : (current + chunk.toString('utf8')).slice(0, maxBytes)

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = append(stdout, chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = append(stderr, chunk)
      })

      const settle = (code: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, stdout, stderr, timedOut })
      }

      child.on('error', (error: Error) => {
        stderr = stderr || error.message
        settle(-1)
      })
      child.on('close', (code) => settle(code ?? -1))
    })
  }

  async readTextFile(path: string): Promise<string> {
    return readFile(path, 'utf8')
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, 'utf8')
  }
}
