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
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LOCK_PATH = process.env.OXESPACE_HEAVY_LOCK || join(tmpdir(), 'oxespace-heavy.lock')
const MAX_AGE_MS = Number(process.env.OXESPACE_HEAVY_LOCK_MAX_MINUTES || 120) * 60_000
const POLL_MS = 5_000

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
