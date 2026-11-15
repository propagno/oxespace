/**
 * One heavy process at a time on this machine, across every session and worktree: build, a full tsc, test:electron,
 * Electron, Playwright, Gradle. Each heavy command runs through this script, which waits for the machine-wide lock,
 * runs the command, and releases the lock when it ends.
 *
 *   node scripts/heavy-lock.mjs --owner <who> -- <command> [args...]
 *   node scripts/heavy-lock.mjs --status
 *
 * The lock is a JSON file created atomically, content included (a hard link of a side file), in the system temp folder, holding the owner, the PID of the
 * process that holds it and when it was taken. It counts as left behind, and is taken over, when that PID no longer
 * runs or it is older than OXESPACE_HEAVY_LOCK_MAX_MINUTES (120 by default). Only its holder removes it.
 * Once it holds the lock, a command waits for OXESPACE_HEAVY_MIN_FREE_GB of free memory (1 by default), but for
 * OXESPACE_HEAVY_MEMORY_WAIT_MINUTES at most (5): then it gives the lock back and queues again, so a holder that cannot
 * start never keeps the machine waiting. While it waits, `--status` says so.
 * OXESPACE_HEAVY_LOCK overrides the path (tests).
 */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, linkSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { freemem, tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LOCK_PATH = process.env.OXESPACE_HEAVY_LOCK || join(tmpdir(), 'oxespace-heavy.lock')
const MAX_AGE_MS = Number(process.env.OXESPACE_HEAVY_LOCK_MAX_MINUTES || 120) * 60_000
const POLL_MS = 5_000
/** Free memory a heavy command needs before it starts, in GB; 0 turns the check off. */
export const MIN_FREE_GB = process.env.OXESPACE_HEAVY_MIN_FREE_GB === undefined ? 1 : Number(process.env.OXESPACE_HEAVY_MIN_FREE_GB)

export const freeGb = () => freemem() / 2 ** 30
/** How long a holder waits for memory before it gives the lock back, in ms. */
export const MEMORY_WAIT_MAX_MS = Number(process.env.OXESPACE_HEAVY_MEMORY_WAIT_MINUTES || 5) * 60_000

/**
 * Waits until the machine has `floor` GB free, polling `read`. Holding the lock is not enough: a command that
 * queued behind a build starts when the build ends, which is when memory is lowest, and the first thing it meets
 * is the low-memory guard. Resolves with how many times it waited, or null when `maxWaitMs` passed first: the caller
 * then gives the lock back rather than hold it idle. `onPoll` hears each reading that was too low.
 */
export async function waitForMemory(floor = MIN_FREE_GB, read = freeGb, pollMs = POLL_MS, onWait = () => {}, maxWaitMs = Infinity, onPoll = () => {}) {
  let waits = 0
  const start = Date.now()
  for (let free = read(); floor > 0 && free < floor; free = read()) {
    if (waits === 0) onWait()
    onPoll(free)
    if (Date.now() - start >= maxWaitMs) return null
    waits++
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  return waits
}

export function readLock(path = LOCK_PATH) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

export function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/** Whether the lock in place was left behind: unreadable, its holder gone, or too old. */
export function isStale(lock, now = Date.now()) {
  return !lock || !isRunning(lock.pid) || !(now - lock.takenAt < MAX_AGE_MS)
}

/** An unreadable lock this young is a holder still writing it (an older copy of this script), not one left behind. */
export const UNREADABLE_GRACE_MS = 5_000

/**
 * Creates the lock with its content in one step: the JSON goes to a side file that is hard-linked to the lock path,
 * which fails with EEXIST when the lock exists. A reader never sees the lock empty: with `wx` then a write, a second
 * command starting at the same moment read an empty file, judged it left behind and took it too (run 41405625020).
 * Where hard links are unsupported, falls back to `wx`.
 */
function publish(path, entry) {
  const side = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.new`
  writeFileSync(side, entry)
  try {
    linkSync(side, path)
    return true
  } catch (error) {
    if (error.code === 'EEXIST') return false
    if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(error.code)) throw error
    try {
      const fd = openSync(path, 'wx')
      try { writeSync(fd, entry) } finally { closeSync(fd) }
      return true
    } catch (fallback) {
      if (fallback.code === 'EEXIST') return false
      throw fallback
    }
  } finally {
    try { unlinkSync(side) } catch { /* already gone */ }
  }
}

const holds = path => readLock(path)?.pid === process.pid

/** Takes the lock if it is free or left behind; true when this process now holds it. */
export function tryTake(owner, command, path = LOCK_PATH, now = Date.now()) {
  const entry = JSON.stringify({ owner, pid: process.pid, command, takenAt: now })
  if (publish(path, entry)) return true
  let seen
  try { seen = readFileSync(path, 'utf8') } catch { return publish(path, entry) && holds(path) }
  let lock = null
  try { lock = JSON.parse(seen) } catch { /* unreadable */ }
  if (!lock) {
    let age = Infinity
    try { age = now - statSync(path).mtimeMs } catch { /* gone */ }
    if (age < UNREADABLE_GRACE_MS) return false
  }
  if (!isStale(lock, now)) return false
  // Left behind: remove it only if it is still the one judged left behind (another command may have taken it over
  // meanwhile), then race for it once more; whoever creates it first holds it, and a holder confirms it is its own.
  try { if (readFileSync(path, 'utf8') === seen) unlinkSync(path) } catch { /* someone else removed it first */ }
  return publish(path, entry) && holds(path)
}

/**
 * The holder notes in its lock what it is waiting for (`null` clears it), so `--status` can tell an idle holder from a
 * busy one. Written to a side file and renamed over the lock: a reader never sees half of it, which would read as
 * left behind and be taken over.
 */
export function noteWaiting(waiting, path = LOCK_PATH) {
  const lock = readLock(path)
  if (!lock || lock.pid !== process.pid) return false
  const next = { ...lock }
  if (waiting) next.waiting = waiting
  else delete next.waiting
  const side = `${path}.${process.pid}.tmp`
  writeFileSync(side, JSON.stringify(next))
  try { renameSync(side, path) } catch { try { unlinkSync(side) } catch { /* nothing to clean */ } return false }
  return true
}

/** One line for `--status`. */
export function describeLock(lock, now = Date.now()) {
  if (!lock) return 'free'
  const memory = lock.waiting?.memory
  const idle = memory ? ` (idle: waiting for memory, ${memory.free.toFixed(1)} GB free, need ${memory.need})` : ''
  return `${isStale(lock, now) ? 'left behind' : 'held'} by ${lock.owner} (pid ${lock.pid}) since ${new Date(lock.takenAt).toISOString()}${idle}: ${lock.command}`
}

/** Removes the lock only when this process holds it. */
export function release(path = LOCK_PATH) {
  const lock = readLock(path)
  if (lock && lock.pid === process.pid) { try { unlinkSync(path) } catch { /* already gone */ } }
}

/**
 * Where a command runs from (OXE-114). On Windows a relative .bat or .cmd given with a folder, like
 * `mobile/android/gradlew.bat`, reaches cmd.exe as typed, and cmd reads the forward slashes as switches: it fails.
 * Such a command is resolved against the working folder and runs from its own folder, as a wrapper like gradlew
 * expects. A bare name (npm.cmd, a .bat on PATH) and every other command run as given, from the working folder.
 */
export function resolveCommand(command, cwd = process.cwd(), platform = process.platform, exists = existsSync) {
  if (platform !== 'win32' || win32.isAbsolute(command) || !/\.(bat|cmd)$/i.test(command)) return { command, cwd }
  const local = win32.resolve(cwd, command)
  if (!/[\\/]/.test(command) && !exists(local)) return { command, cwd }
  return { command: local, cwd: win32.dirname(local) }
}

/** The local.properties line Gradle reads for the SDK, escaped the way Android Studio writes it. */
export const sdkDirLine = sdk => `sdk.dir=${sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}`

/**
 * A new worktree has no local.properties (it is not versioned), so its Android build cannot find the SDK (OXE-114).
 * Before a gradlew command, the Android folder gets one when it lacks it: the main checkout's file when there is
 * one, else sdk.dir from ANDROID_HOME or ANDROID_SDK_ROOT. An existing file is never touched. Returns what it did.
 */
export function ensureLocalProperties(androidDir, mainAndroidDir, env = process.env, fs = { existsSync, readFileSync, writeFileSync }) {
  const target = join(androidDir, 'local.properties')
  if (fs.existsSync(target)) return 'kept'
  if (!fs.existsSync(join(androidDir, 'settings.gradle')) && !fs.existsSync(join(androidDir, 'settings.gradle.kts'))) return 'not-android'
  const main = mainAndroidDir ? join(mainAndroidDir, 'local.properties') : null
  if (main && resolve(main) !== resolve(target) && fs.existsSync(main)) {
    fs.writeFileSync(target, fs.readFileSync(main, 'utf8'))
    return 'copied'
  }
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT
  if (!sdk) return 'no-sdk'
  fs.writeFileSync(target, `${sdkDirLine(sdk)}\n`)
  return 'written'
}

/** The Android folder of the main checkout that holds this worktree, from git's common dir, or null. */
function mainAndroidDir(cwd) {
  try {
    const top = readFileSync(join(cwd, '.git'), 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
    // A worktree's .git file points at <main>/.git/worktrees/<name>; the main checkout is two folders above it.
    return top ? join(resolve(cwd, top), '..', '..', '..', 'mobile', 'android') : null
  } catch { return null }
}

async function main(argv) {
  if (argv[0] === '--status') {
    console.log(describeLock(readLock()))
    return 0
  }
  const ownerAt = argv.indexOf('--owner')
  const separator = argv.indexOf('--')
  const owner = ownerAt >= 0 ? argv[ownerAt + 1] : `pid ${process.pid}`
  const [command, ...args] = separator >= 0 ? argv.slice(separator + 1) : argv.filter((_, index) => index !== ownerAt && index !== ownerAt + 1)
  if (!command) { console.error('usage: node scripts/heavy-lock.mjs --owner <who> -- <command> [args...]  |  --status'); return 2 }
  const text = [command, ...args].join(' ')
  const stop = signal => { release(); process.exit(signal === 'SIGINT' ? 130 : 143) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('exit', () => release())
  for (;;) {
    let waited = false
    while (!tryTake(owner, text)) {
      if (!waited) { const lock = readLock(); console.error(`[heavy-lock] waiting: ${lock?.owner ?? 'another process'} is running ${lock?.command ?? 'a heavy command'}`); waited = true }
      await new Promise(resolve => setTimeout(resolve, POLL_MS))
    }
    // The lock is ours; the memory may not be yet. Other sessions wait on the lock meanwhile, which is the point, but
    // only for a while: past MEMORY_WAIT_MAX_MS the lock goes back and this command queues again.
    const ready = await waitForMemory(MIN_FREE_GB, freeGb, POLL_MS,
      () => console.error(`[heavy-lock] waiting: ${freeGb().toFixed(1)} GB free, ${MIN_FREE_GB} GB needed`),
      MEMORY_WAIT_MAX_MS, free => noteWaiting({ memory: { free, need: MIN_FREE_GB } }))
    if (ready !== null) { noteWaiting(null); break }
    release()
    console.error(`[heavy-lock] gave the lock back after ${MEMORY_WAIT_MAX_MS / 60_000} min waiting for memory; queueing again`)
    // A turn for whoever was queued behind, before this one asks again.
    await new Promise(resolve => setTimeout(resolve, 2 * POLL_MS))
  }
  return await new Promise(resolve => {
    // npm and npx are .cmd files on Windows and need the shell; an executable given by its full path does not.
    const run = resolveCommand(command)
    if (/^gradlew(\.bat)?$/i.test(basename(run.command))) {
      const top = resolve(run.cwd, '..', '..')
      const done = ensureLocalProperties(run.cwd, mainAndroidDir(top))
      if (done === 'copied' || done === 'written') console.error(`[heavy-lock] wrote ${join(run.cwd, 'local.properties')} (${done}), which this worktree lacked`)
      if (done === 'no-sdk') console.error('[heavy-lock] this worktree has no local.properties and ANDROID_HOME is not set: Gradle may not find the SDK')
    }
    const shell = process.platform === 'win32' && !(isAbsolute(run.command) && /\.(exe|com)$/i.test(run.command))
    // Through the shell, an argument with spaces or shell characters stays one argument only when quoted.
    const quoted = shell ? args.map(arg => /[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg) : args
    const executable = shell && /\s/.test(run.command) ? `"${run.command}"` : run.command
    const child = spawn(executable, quoted, { stdio: 'inherit', shell, cwd: run.cwd })
    child.on('error', error => { console.error(`[heavy-lock] ${error.message}`); resolve(1) })
    child.on('close', code => resolve(code ?? 1))
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main(process.argv.slice(2)))
