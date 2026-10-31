/**
 * One heavy process at a time on this machine, across every session and worktree: build, a full tsc, test:electron,
 * Electron, Playwright, Gradle. Each heavy command runs through this script, which waits for the machine-wide lock,
 * runs the command, and releases the lock when it ends.
 *
 *   node scripts/heavy-lock.mjs --owner <who> -- <command> [args...]
 *   node scripts/heavy-lock.mjs --status
 *
 * The lock is a JSON file created atomically (`wx`) in the system temp folder, holding the owner, the PID of the
 * process that holds it and when it was taken. It counts as left behind, and is taken over, when that PID no longer
 * runs or it is older than OXESPACE_HEAVY_LOCK_MAX_MINUTES (120 by default). Only its holder removes it.
 * OXESPACE_HEAVY_LOCK overrides the path (tests).
 */
import { spawn } from 'node:child_process'
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { freemem, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LOCK_PATH = process.env.OXESPACE_HEAVY_LOCK || join(tmpdir(), 'oxespace-heavy.lock')
const MAX_AGE_MS = Number(process.env.OXESPACE_HEAVY_LOCK_MAX_MINUTES || 120) * 60_000
const POLL_MS = 5_000
/** Free memory a heavy command needs before it starts, in GB; 0 turns the check off. */
export const MIN_FREE_GB = process.env.OXESPACE_HEAVY_MIN_FREE_GB === undefined ? 1 : Number(process.env.OXESPACE_HEAVY_MIN_FREE_GB)

export const freeGb = () => freemem() / 2 ** 30

/**
 * Waits until the machine has `floor` GB free, polling `read`. Holding the lock is not enough: a command that
 * queued behind a build starts when the build ends, which is when memory is lowest, and the first thing it meets
 * is the low-memory guard. Resolves with how many times it waited.
 */
export async function waitForMemory(floor = MIN_FREE_GB, read = freeGb, pollMs = POLL_MS, onWait = () => {}) {
  let waits = 0
  while (floor > 0 && read() < floor) {
    if (waits === 0) onWait()
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

/** Takes the lock if it is free or left behind; true when this process now holds it. */
export function tryTake(owner, command, path = LOCK_PATH, now = Date.now()) {
  const entry = JSON.stringify({ owner, pid: process.pid, command, takenAt: now })
  try {
    const fd = openSync(path, 'wx')
    try { writeSync(fd, entry) } finally { closeSync(fd) }
    return true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  if (!isStale(readLock(path), now)) return false
  // Left behind: remove it and race for it once more; whoever creates it first holds it.
  try { unlinkSync(path) } catch { /* someone else removed it first */ }
  try {
    const fd = openSync(path, 'wx')
    try { writeSync(fd, entry) } finally { closeSync(fd) }
    return true
  } catch { return false }
}

/** Removes the lock only when this process holds it. */
export function release(path = LOCK_PATH) {
  const lock = readLock(path)
  if (lock && lock.pid === process.pid) { try { unlinkSync(path) } catch { /* already gone */ } }
}

async function main(argv) {
  if (argv[0] === '--status') {
    const lock = readLock()
    console.log(lock ? `${isStale(lock) ? 'left behind' : 'held'} by ${lock.owner} (pid ${lock.pid}) since ${new Date(lock.takenAt).toISOString()}: ${lock.command}` : 'free')
    return 0
  }
  const ownerAt = argv.indexOf('--owner')
  const separator = argv.indexOf('--')
  const owner = ownerAt >= 0 ? argv[ownerAt + 1] : `pid ${process.pid}`
  const [command, ...args] = separator >= 0 ? argv.slice(separator + 1) : argv.filter((_, index) => index !== ownerAt && index !== ownerAt + 1)
  if (!command) { console.error('usage: node scripts/heavy-lock.mjs --owner <who> -- <command> [args...]  |  --status'); return 2 }
  const text = [command, ...args].join(' ')
  let waited = false
  while (!tryTake(owner, text)) {
    if (!waited) { const lock = readLock(); console.error(`[heavy-lock] waiting: ${lock?.owner ?? 'another process'} is running ${lock?.command ?? 'a heavy command'}`); waited = true }
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
  const stop = signal => { release(); process.exit(signal === 'SIGINT' ? 130 : 143) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('exit', () => release())
  // The lock is ours; the memory may not be yet. Other sessions wait on the lock meanwhile, which is the point.
  await waitForMemory(MIN_FREE_GB, freeGb, POLL_MS, () => console.error(`[heavy-lock] waiting: ${freeGb().toFixed(1)} GB free, ${MIN_FREE_GB} GB needed`))
  return await new Promise(resolve => {
    // npm and npx are .cmd files on Windows and need the shell; an executable given by its full path does not.
    const shell = process.platform === 'win32' && !(isAbsolute(command) && /\.(exe|com)$/i.test(command))
    // Through the shell, an argument with spaces or shell characters stays one argument only when quoted.
    const quoted = shell ? args.map(arg => /[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg) : args
    const child = spawn(command, quoted, { stdio: 'inherit', shell })
    child.on('error', error => { console.error(`[heavy-lock] ${error.message}`); resolve(1) })
    child.on('close', code => resolve(code ?? 1))
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main(process.argv.slice(2)))
