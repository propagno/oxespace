import { execFile } from 'node:child_process'
import { win32 } from 'node:path'

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
 *
 * Safety on Linux/macOS (a fake PTY with pid 1 once took down a CI runner: `kill(-1)` signals every process the user
 * owns, and every orphan is a ps descendant of init). Only what `planPosixKill` returns is ever signalled:
 * - the root must be at least 2, not this process and not one of its ancestors (by `ps`, and its parent always);
 * - the group `-root` only when `ps` shows the root leads its own group (pgid === pid) and that group is not ours;
 * - descendants only as found by walking `ps` down from the root, never this process or an ancestor of it;
 * - when `ps` fails, the root alone, without its group.
 */
export interface ProcessTreeDeps {
  platform: NodeJS.Platform
  /** This process: never signalled, nor its ancestors. Injected by tests. */
  self: { pid: number; ppid: number }
  kill: (pid: number, signal: NodeJS.Signals | 0) => void
  /** Runs a command and hands back its stdout ('' on failure). */
  run: (file: string, args: string[], timeoutMs: number) => Promise<string>
  graceMs: number
}

const POLL_MS = 50
const TASKKILL_TIMEOUT_MS = 3000
const PS_TIMEOUT_MS = 1500
// By absolute path: a bare name is looked up in the current directory first on Windows, then along PATH.
const TASKKILL = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
const PS = '/bin/ps'

const defaultDeps: ProcessTreeDeps = {
  platform: process.platform,
  self: { pid: process.pid, ppid: process.ppid },
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
const pending = new Map<number, { deps: ProcessTreeDeps; plan: PosixKillPlan }>()
let exitHookInstalled = false

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once('exit', () => {
    for (const entry of pending.values()) signalAll(entry.deps, entry.plan, 'SIGKILL')
  })
}

/** A pid that may be signalled at all: 0, 1 and -1 (or any group of them) mean "everyone" or init. */
function signallable(pid: number): boolean {
  return Number.isInteger(pid) && pid >= 2
}

function trySignal(deps: ProcessTreeDeps, pid: number, signal: NodeJS.Signals | 0): boolean {
  // The last line of defence: whatever a plan says, never kill(0), kill(1), kill(-1) or kill(-0).
  if (!signallable(Math.abs(pid))) return false
  try { deps.kill(pid, signal); return true } catch (error) { return (error as NodeJS.ErrnoException)?.code === 'EPERM' }
}

function signalAll(deps: ProcessTreeDeps, plan: PosixKillPlan, signal: NodeJS.Signals): void {
  if (plan.group) trySignal(deps, -plan.root, signal)
  for (const pid of [plan.root, ...plan.pids]) trySignal(deps, pid, signal)
}

interface PsRow { ppid: number; pgid: number | undefined }

/** `ps -A -o pid=,ppid=,pgid=` (the pgid column optional) as pid → row. Unparsable lines are skipped. */
function parsePs(output: string): Map<number, PsRow> {
  const table = new Map<number, PsRow>()
  for (const line of output.split('\n')) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number)
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0) continue
    table.set(pid, { ppid, pgid: Number.isInteger(pgid) && pgid > 0 ? pgid : undefined })
  }
  return table
}

function descendantsIn(table: Map<number, PsRow>, root: number): number[] {
  const children = new Map<number, number[]>()
  for (const [pid, row] of table) {
    const list = children.get(row.ppid) ?? []
    list.push(pid)
    children.set(row.ppid, list)
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

/** Descendants of `root` from `ps -A -o pid=,ppid=[,pgid=]` output, closest first. */
export function descendantsFromPs(output: string, root: number): number[] {
  return descendantsIn(parsePs(output), root)
}

/** What a POSIX tree kill may signal: the root, its group only when verified, and verified descendants. */
export interface PosixKillPlan { root: number; group: boolean; pids: number[] }

/**
 * The plan for killing `root`'s tree from a `ps` snapshot, or null when nothing may be signalled: the root is below 2,
 * this process, or one of its ancestors. Pure, so the rules are tested with an injected `ps` output.
 */
export function planPosixKill(output: string, root: number, self: { pid: number; ppid: number }): PosixKillPlan | null {
  if (!signallable(root) || root === self.pid || root === self.ppid) return null
  const table = parsePs(output)
  // No snapshot: nothing can be verified, so the root alone; never a group.
  if (!table.size) return { root, group: false, pids: [] }
  // This process and its whole ancestry (the test runner, the step shell, the CI runner, init) are untouchable.
  const shielded = new Set<number>([0, 1, self.pid, self.ppid])
  const walked = new Set<number>()
  for (let pid = self.pid; table.has(pid) && !walked.has(pid);) {
    walked.add(pid)
    pid = table.get(pid)!.ppid
    shielded.add(pid)
  }
  if (shielded.has(root)) return null
  const row = table.get(root)
  // Not in the snapshot: already gone, so there is no tree to walk.
  if (!row) return { root, group: false, pids: [] }
  // The group only when the root leads it and no shielded process belongs to it (our own group, say).
  const group = row.pgid === root && ![...shielded].some(pid => table.get(pid)?.pgid === root)
  const pids = descendantsIn(table, root).filter(pid => signallable(pid) && !shielded.has(pid))
  return { root, group, pids }
}

function anyAlive(deps: ProcessTreeDeps, plan: PosixKillPlan): boolean {
  return (plan.group && trySignal(deps, -plan.root, 0)) || [plan.root, ...plan.pids].some(pid => trySignal(deps, pid, 0))
}

async function killPosixTree(root: number, deps: ProcessTreeDeps): Promise<void> {
  const plan = planPosixKill(await deps.run(PS, ['-A', '-o', 'pid=,ppid=,pgid='], PS_TIMEOUT_MS), root, deps.self)
  if (!plan) return
  pending.set(root, { deps, plan })
  installExitHook()
  signalAll(deps, plan, 'SIGTERM')
  const deadline = Date.now() + deps.graceMs
  await new Promise<void>(resolve => {
    const tick = (): void => {
      if (!anyAlive(deps, plan)) { resolve(); return }
      if (Date.now() >= deadline) { signalAll(deps, plan, 'SIGKILL'); resolve(); return }
      setTimeout(tick, POLL_MS).unref?.()
    }
    tick()
  })
  pending.delete(root)
}

export function killProcessTree(pid: number | undefined | null, overrides: Partial<ProcessTreeDeps> = {}): Promise<void> {
  const deps = { ...defaultDeps, ...overrides }
  // Below 2 is "every process" (-1 as a group, 0 our own group) or init; never a tree we were asked to end.
  if (!pid || !signallable(pid) || pid === deps.self.pid || pid === process.pid) return Promise.resolve()
  const existing = inFlight.get(pid)
  if (existing) return existing
  const work = (deps.platform === 'win32'
    ? deps.run(TASKKILL, ['/pid', String(pid), '/T', '/F'], TASKKILL_TIMEOUT_MS).then(() => undefined)
    : killPosixTree(pid, deps)
  ).catch(() => undefined).finally(() => inFlight.delete(pid))
  inFlight.set(pid, work)
  return work
}

interface KillablePty { readonly pid: number; kill(): void }

/**
 * Ends a PTY and its tree. The tree goes first and the PTY's own kill follows, releasing the pseudo console: the
 * children are found from a live root (taskkill's walk on Windows, the `ps` snapshot elsewhere). Releasing first
 * SIGHUPs the shell before the snapshot, its detached children are reparented to init, and they are missed.
 */
export function terminatePty(pty: KillablePty | null | undefined, overrides: Partial<ProcessTreeDeps> = {}): Promise<void> {
  if (!pty) return Promise.resolve()
  const release = (): void => { try { pty.kill() } catch { /* already gone */ } }
  let pid: number | undefined
  try { pid = pty.pid } catch { pid = undefined }
  if (!pid || !Number.isInteger(pid) || pid <= 0) { release(); return Promise.resolve() }
  return killProcessTree(pid, overrides).finally(release)
}
