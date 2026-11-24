import { execFile, spawnSync } from 'node:child_process'
import { delimiter } from 'node:path'

/**
 * Recover the PATH the user actually has in their shell.
 *
 * A desktop launcher does not start a login shell, so an app launched from the
 * dock/Activities inherits the session PATH — on Ubuntu roughly
 * `/usr/local/bin:/usr/bin:/bin:/usr/games`. Everything a developer installs
 * for themselves is missing from it: `~/.local/bin`, `~/.npm-global/bin`,
 * nvm's `~/.nvm/versions/node/*\/bin`, asdf shims, Homebrew on Linux.
 *
 * That is invisible until it is not. Agent CLIs are stored as bare commands
 * (`claude`, `copilot`), so with the session PATH the provider check reports
 * "Not on PATH" and, worse, a pane bound to an agent fails to spawn at all —
 * an agent is exec'd directly, never through a shell, so it never reads a
 * profile. Launching the same build from a terminal works, which is what makes
 * the bug read as random.
 *
 * Asking the login shell is the only answer that covers version managers,
 * whose PATH entries are computed rather than fixed.
 */

const PROBE_TIMEOUT_MS = 3_000
const PROBE_MAX_BUFFER_BYTES = 1024 * 1024

export interface LoginShellPathOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  run?: typeof spawnSync
}

export interface AsyncLoginShellRunResult {
  stdout: string
  status: number | null
  error?: Error
}

export interface AsyncLoginShellRunOptions {
  encoding: 'utf8'
  timeout: number
  windowsHide: boolean
  maxBuffer: number
}

export interface AsyncLoginShellPathOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  runAsync?: (
    file: string,
    args: readonly string[],
    options: AsyncLoginShellRunOptions
  ) => Promise<AsyncLoginShellRunResult>
}

/**
 * The login shell's PATH, or null when it cannot be determined — no shell, the
 * probe failed, it timed out, or we are on Windows, where the registry already
 * gives every process the same PATH.
 */
export function readLoginShellPath(options: LoginShellPathOptions = {}): string | null {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const run = options.run ?? spawnSync

  if (platform === 'win32') return null

  const shell = env.SHELL
  if (!shell) return null

  // -l sources the login profile; on Ubuntu ~/.profile in turn sources
  // ~/.bashrc, so this also picks up PATH set there. Deliberately NOT -i:
  // an interactive shell can block on a profile that expects a terminal.
  const result = run(shell, ['-lc', 'printf %s "$PATH"'], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
    // A profile that writes to stderr (version manager banners, MOTD hooks)
    // must not end up mixed into the value we parse.
    stdio: ['ignore', 'pipe', 'ignore']
  })

  if (result.error || result.status !== 0) return null
  const value = (result.stdout ?? '').trim()
  return value.length > 0 ? value : null
}

/**
 * Union of the current PATH and the login shell's, current entries first so an
 * explicitly exported PATH still wins. Returns the input unchanged when there
 * is nothing to add, so callers can skip the assignment.
 */
export function mergePath(currentPath: string, loginPath: string): string {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const part of [...currentPath.split(delimiter), ...loginPath.split(delimiter)]) {
    const entry = part.trim()
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    merged.push(entry)
  }
  return merged.join(delimiter)
}

/**
 * Merge the login shell's PATH into `env` in place. Returns the entries that
 * were added, so the caller can log what a launcher had been hiding.
 *
 * Costs one shell spawn. Called once during startup rather than lazily,
 * because both consumers — provider discovery and the first agent pane — can
 * run before any user interaction.
 */
export function applyLoginShellPath(options: LoginShellPathOptions = {}): string[] {
  const env = options.env ?? process.env
  const loginPath = readLoginShellPath(options)
  if (!loginPath) return []

  const current = env.PATH ?? ''
  const merged = mergePath(current, loginPath)
  if (merged === current) return []

  const before = new Set(current.split(delimiter).filter(Boolean))
  env.PATH = merged
  return merged.split(delimiter).filter((entry) => !before.has(entry))
}

function defaultRunAsync(
  file: string,
  args: readonly string[],
  options: AsyncLoginShellRunOptions
): Promise<AsyncLoginShellRunResult> {
  return new Promise((resolve) => {
    try {
      const child = execFile(file, args, options, (error, stdout) => {
        if (error) {
          const code = typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : null
          resolve({ stdout: '', status: code, error })
          return
        }
        resolve({ stdout: stdout ?? '', status: 0 })
      })
      child.stdin?.end()
    } catch (error) {
      resolve({ stdout: '', status: null, error: error instanceof Error ? error : new Error(String(error)) })
    }
  })
}

/**
 * Non-blocking variant of `readLoginShellPath` for Electron main-process cold
 * start. Uses `execFile` so the event loop and `ready-to-show` are never
 * blocked waiting on a user's login profile. Never rejects.
 */
export async function readLoginShellPathAsync(options: AsyncLoginShellPathOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const runAsync = options.runAsync ?? defaultRunAsync

  if (platform === 'win32') return null

  const shell = env.SHELL
  if (!shell) return null

  let result: AsyncLoginShellRunResult
  try {
    result = await runAsync(shell, ['-lc', 'printf %s "$PATH"'], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: PROBE_MAX_BUFFER_BYTES
    })
  } catch {
    return null
  }

  if (result.error || result.status !== 0) return null
  const value = (result.stdout ?? '').trim()
  return value.length > 0 ? value : null
}

/**
 * Non-blocking variant of `applyLoginShellPath`. Merges the login shell's PATH
 * into `env` in place once the probe resolves, preserving any PATH entries
 * added while the probe was in flight. Returns the newly added entries.
 */
export async function applyLoginShellPathAsync(options: AsyncLoginShellPathOptions = {}): Promise<string[]> {
  const env = options.env ?? process.env
  const loginPath = await readLoginShellPathAsync(options)
  if (!loginPath) return []

  const current = env.PATH ?? ''
  const merged = mergePath(current, loginPath)
  if (merged === current) return []

  const before = new Set(current.split(delimiter).filter(Boolean))
  env.PATH = merged
  return merged.split(delimiter).filter((entry) => !before.has(entry))
}
