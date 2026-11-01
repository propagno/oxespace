import { execFile } from 'node:child_process'

/**
 * Ends a process and everything it started (BE-M-08). Best-effort, idempotent, never throws and never blocks:
 * the promise settles once the tree is gone or the bounded wait is over.
 *
 * - Windows: `taskkill /T /F` walks the tree by parent pid, so it also reaches children that left the console (a
 *   detached `npm run dev`), which node-pty's own kill (the console's process list) misses. It must run while the
 *   root is still alive: once the root is gone its children cannot be found from it. node-pty does not expose a job
 *   object, and putting the PTY in one would need a native module of our own; taskkill is what the conversation
 *   transport already used.
 * - Linux/macOS: the root is a session or group leader (node-pty calls setsid; the transport spawns detached), so
 *   SIGTERM goes to its group. An interactive shell puts each job in a group of its own, so the descendants found
 *   by `ps` are signalled one by one too. After a short grace, SIGKILL reaches whatever is left, including a process
 *   that ignores SIGTERM. A process that left the session and the tree (a daemon that double-forked) is out of reach.
 */
export interface ProcessTreeDeps {
  platform: NodeJS.Platform
  kill: (pid: number, signal: NodeJS.Signals | 0) => void
  /** Runs a command and hands back its stdout ('' on failure). */
  run: (file: string, args: string[], timeoutMs: number) => Promise<string>
  graceMs: number
}

const POLL_MS = 50
const TASKKILL_TIMEOUT_MS = 3000
const PS_TIMEOUT_MS = 1500

const defaultDeps: ProcessTreeDeps = {
  platform: process.platform,
  kill: (pid, signal) => { process.kill(pid, signal) },
  run: (file, args, timeoutMs) => new Promise(resolve => {
    try {
      execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => resolve(String(stdout ?? '')))
    } catch { resolve('') }
  }),
  graceMs: 500
}

const inFlight = new Map<number, Promise<void>>()
/** Trees still inside their grace period: SIGKILLed synchronously if the app exits first. */
const pending = new Map<number, { deps: ProcessTreeDeps; pids: number[] }>()
let exitHookInstalled = false

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once('exit', () => {
    for (const [root, entry] of pending) signalAll(entry.deps, root, entry.pids, 'SIGKILL')
  })
}

function trySignal(deps: ProcessTreeDeps, pid: number, signal: NodeJS.Signals | 0): boolean {
  try { deps.kill(pid, signal); return true } catch (error) { return (error as NodeJS.ErrnoException)?.code === 'EPERM' }
}

function signalAll(deps: ProcessTreeDeps, root: number, pids: number[], signal: NodeJS.Signals): void {
  trySignal(deps, -root, signal)
  for (const pid of [root, ...pids]) trySignal(deps, pid, signal)
}

/** Descendants of `root` from `ps -A -o pid=,ppid=` output, closest first. */
export function descendantsFromPs(output: string, root: number): number[] {
  const children = new Map<number, number[]>()
  for (const line of output.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0) continue
    const list = children.get(ppid) ?? []
    list.push(pid)
    children.set(ppid, list)
  }
  const found: number[] = []
  const seen = new Set<number>([root])
  const queue = [root]
  while (queue.length) {
    for (const child of children.get(queue.shift() as number) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      found.push(child)
      queue.push(child)
    }
  }
  return found
}

function anyAlive(deps: ProcessTreeDeps, root: number, pids: number[]): boolean {
  return trySignal(deps, -root, 0) || [root, ...pids].some(pid => trySignal(deps, pid, 0))
}

async function killPosixTree(root: number, deps: ProcessTreeDeps): Promise<void> {
  const pids = descendantsFromPs(await deps.run('ps', ['-A', '-o', 'pid=,ppid='], PS_TIMEOUT_MS), root)
    .filter(pid => pid !== process.pid)
  pending.set(root, { deps, pids })
  installExitHook()
  signalAll(deps, root, pids, 'SIGTERM')
  const deadline = Date.now() + deps.graceMs
  await new Promise<void>(resolve => {
    const tick = (): void => {
      if (!anyAlive(deps, root, pids)) { resolve(); return }
      if (Date.now() >= deadline) { signalAll(deps, root, pids, 'SIGKILL'); resolve(); return }
      setTimeout(tick, POLL_MS).unref?.()
    }
    tick()
  })
  pending.delete(root)
}

export function killProcessTree(pid: number | undefined | null, overrides: Partial<ProcessTreeDeps> = {}): Promise<void> {
  if (!pid || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) return Promise.resolve()
  const existing = inFlight.get(pid)
  if (existing) return existing
  const deps = { ...defaultDeps, ...overrides }
  const work = (deps.platform === 'win32'
    ? deps.run('taskkill.exe', ['/pid', String(pid), '/T', '/F'], TASKKILL_TIMEOUT_MS).then(() => undefined)
    : killPosixTree(pid, deps)
  ).catch(() => undefined).finally(() => inFlight.delete(pid))
  inFlight.set(pid, work)
  return work
}

interface KillablePty { readonly pid: number; kill(): void }

/**
 * Ends a PTY and its tree. On Windows the tree goes first (taskkill needs the shell alive to find its children) and
 * the PTY's own kill follows, releasing the pseudo console; elsewhere both go at once.
 */
export function terminatePty(pty: KillablePty | null | undefined, overrides: Partial<ProcessTreeDeps> = {}): Promise<void> {
  if (!pty) return Promise.resolve()
  const release = (): void => { try { pty.kill() } catch { /* already gone */ } }
  const platform = overrides.platform ?? defaultDeps.platform
  let pid: number | undefined
  try { pid = pty.pid } catch { pid = undefined }
  if (!pid || !Number.isInteger(pid) || pid <= 0) { release(); return Promise.resolve() }
  const tree = killProcessTree(pid, overrides)
  if (platform === 'win32') return tree.finally(release)
  release()
  return tree
}
