/**
 * One heavy process at a time on this machine, across every session and worktree: build, a full tsc, test:electron,
 * Electron, Playwright, Gradle. Each heavy command runs through this script, which waits for its turn, runs the
 * command, and releases the lock when it ends.
 *
 *   node scripts/heavy-lock.mjs --owner <who> [--priority high|normal|low] -- <command> [args...]
 *   node scripts/heavy-lock.mjs --status
 *
 * The lock is a JSON file created atomically (`wx`) in the system temp folder, holding the owner, the PID of the
 * process that holds it and when it was taken. It counts as left behind, and is taken over, when that PID no longer
 * runs or it is older than OXESPACE_HEAVY_LOCK_MAX_MINUTES (120 by default). Only its holder removes it.
 *
 * S0.7 · Nobody holds the lock idle:
 * - Memory is checked BEFORE the lock is taken: a command whose machine has less than OXESPACE_HEAVY_MIN_FREE_GB free
 *   (1 by default; 0 turns the check off) waits without the lock. Right after taking it, the memory is read again; if
 *   it dropped below the floor meanwhile, the lock goes straight back.
 * - Waiters queue in a folder next to the lock, one file each. The lock goes to the first live waiter by priority
 *   (high, then normal, then low), then by who queued first. A waiter whose process is gone is dropped from the queue.
 *   The priority comes from --priority, else OXESPACE_HEAVY_PRIORITY, else the owner's role (ROLE_PRIORITY).
 * OXESPACE_HEAVY_LOCK overrides the path (tests).
 */
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { freemem, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LOCK_PATH = process.env.OXESPACE_HEAVY_LOCK || join(tmpdir(), 'oxespace-heavy.lock')
const MAX_AGE_MS = Number(process.env.OXESPACE_HEAVY_LOCK_MAX_MINUTES || 120) * 60_000
const POLL_MS = Number(process.env.OXESPACE_HEAVY_POLL_MS || 5_000)
/** Free memory a heavy command needs before it starts, in GB; 0 turns the check off. */
export const MIN_FREE_GB = process.env.OXESPACE_HEAVY_MIN_FREE_GB === undefined ? 1 : Number(process.env.OXESPACE_HEAVY_MIN_FREE_GB)

export const freeGb = () => freemem() / 2 ** 30

export const PRIORITIES = { high: 2, normal: 1, low: 0 }
/**
 * The default priority by the owner's role, its name up to the first `-`, `:` or space. Homologation and the release
 * gate a merge or a cut that the whole team waits on; a coordinator's check unblocks the train. Everyone else is normal.
 */
export const ROLE_PRIORITY = { release: 'high', hml: 'high', homolog: 'high', homologation: 'high', coord: 'high', coordinator: 'high' }

/** A priority as a number: a name from PRIORITIES, else the owner's role, else normal. */
export function priorityFor(owner, explicit) {
  const named = typeof explicit === 'string' ? explicit.trim().toLowerCase() : undefined
  if (named && named in PRIORITIES) return PRIORITIES[named]
  const role = String(owner ?? '').toLowerCase().split(/[-:\s]/)[0]
  return PRIORITIES[ROLE_PRIORITY[role] ?? 'normal']
}

/** Waits until `read()` gives at least `floor` GB, polling. Resolves with how many times it waited. No lock is held. */
export async function waitForMemory(floor = MIN_FREE_GB, read = freeGb, pollMs = POLL_MS, onWait = () => {}, onPoll = () => {}) {
  let waits = 0
  for (let free = read(); floor > 0 && free < floor; free = read()) {
    if (waits === 0) onWait()
    onPoll(free)
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

export const queueDir = (path = LOCK_PATH) => `${path}.queue`

/**
 * Writes or refreshes this waiter's entry: { owner, pid, priority, since, command, waiting }. Written to a side file and
 * renamed, so a reader never sees half of it.
 */
export function enqueue(entry, path = LOCK_PATH) {
  const dir = queueDir(path)
  mkdirSync(dir, { recursive: true })
  const side = join(dir, `${entry.pid}.tmp`)
  writeFileSync(side, JSON.stringify(entry))
  try { renameSync(side, join(dir, `${entry.pid}.json`)) } catch { try { unlinkSync(side) } catch { /* nothing to clean */ } }
}

export function dequeue(pid = process.pid, path = LOCK_PATH) {
  try { unlinkSync(join(queueDir(path), `${pid}.json`)) } catch { /* not queued */ }
}

/** The live waiters, first in line first: higher priority, then who queued earlier. Dead or too old ones are dropped. */
export function readQueue(path = LOCK_PATH, now = Date.now()) {
  const dir = queueDir(path)
  let names
  try { names = readdirSync(dir).filter(name => name.endsWith('.json')) } catch { return [] }
  const live = []
  for (const name of names) {
    let entry = null
    try { entry = JSON.parse(readFileSync(join(dir, name), 'utf8')) } catch { /* being renamed, or broken */ }
    if (entry && isRunning(entry.pid) && now - entry.since < MAX_AGE_MS) { live.push(entry); continue }
    // Only a readable entry of a gone or too old process is removed; an unreadable one may be mid-rename.
    if (entry) { try { unlinkSync(join(dir, name)) } catch { /* someone else removed it */ } }
  }
  return live.sort((a, b) => (b.priority - a.priority) || (a.since - b.since) || (a.pid - b.pid))
}

/** Whether `pid` is first in line among the waiters that have the memory to start. Waiting for memory gives no turn. */
export function isMyTurn(pid = process.pid, path = LOCK_PATH, now = Date.now()) {
  const first = readQueue(path, now).find(entry => entry.waiting !== 'memory')
  return !first || first.pid === pid
}

/** One line for the lock, then one per waiter, for `--status`. */
export function describeLock(lock, now = Date.now(), queue = []) {
  const head = lock ? `${isStale(lock, now) ? 'left behind' : 'held'} by ${lock.owner} (pid ${lock.pid}) since ${new Date(lock.takenAt).toISOString()}: ${lock.command}` : 'free'
  const names = Object.fromEntries(Object.entries(PRIORITIES).map(([name, value]) => [value, name]))
  const lines = queue.map((entry, index) => `  ${index + 1}. ${entry.owner} (pid ${entry.pid}, ${names[entry.priority] ?? entry.priority}) ${entry.waiting === 'memory'
    ? `waiting for memory, ${Number(entry.free ?? 0).toFixed(1)} GB free, need ${entry.need}` : 'waiting for the lock'}: ${entry.command}`)
  return [head, ...lines].join('\n')
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Waits for this command's turn and takes the lock. It never holds the lock while it waits: memory first, then its
 * place in the queue, then the lock, then memory once more. Resolves when this process holds the lock.
 */
export async function acquire({ owner, command, priority, path = LOCK_PATH, floor = MIN_FREE_GB, read = freeGb, pollMs = POLL_MS, log = () => {} }) {
  const since = Date.now()
  let said = ''
  const say = text => { if (text !== said) { log(text); said = text } }
  try {
    for (;;) {
      const free = read()
      const low = floor > 0 && free < floor
      enqueue({ owner, pid: process.pid, priority, since, command, ...(low ? { waiting: 'memory', free, need: floor } : { waiting: 'lock' }) }, path)
      if (low) say(`waiting: ${free.toFixed(1)} GB free, ${floor} GB needed (not holding the lock)`)
      else if (!isMyTurn(process.pid, path)) say(`waiting: ${readQueue(path).find(entry => entry.waiting !== 'memory')?.owner ?? 'another command'} is ahead in the queue`)
      else if (!tryTake(owner, command, path)) { const lock = readLock(path); say(`waiting: ${lock?.owner ?? 'another process'} is running ${lock?.command ?? 'a heavy command'}`) }
      else {
        // Memory can drop between the reading and the lock; never hold the lock without it.
        const after = read()
        if (floor <= 0 || after >= floor) return
        release(path)
        say(`gave the lock back: ${after.toFixed(1)} GB free right after taking it, ${floor} GB needed`)
      }
      await sleep(pollMs)
    }
  } finally {
    dequeue(process.pid, path)
  }
}

function parseArgs(argv) {
  const separator = argv.indexOf('--')
  const options = separator >= 0 ? argv.slice(0, separator) : argv
  const value = flag => { const at = options.indexOf(flag); return at >= 0 ? options[at + 1] : undefined }
  const consumed = new Set(['--owner', '--priority'].flatMap(flag => { const at = options.indexOf(flag); return at >= 0 ? [at, at + 1] : [] }))
  const rest = separator >= 0 ? argv.slice(separator + 1) : argv.filter((_, index) => !consumed.has(index))
  return { owner: value('--owner'), priority: value('--priority'), rest }
}

async function main(argv) {
  if (argv[0] === '--status') {
    console.log(describeLock(readLock(), Date.now(), readQueue()))
    return 0
  }
  const parsed = parseArgs(argv)
  const owner = parsed.owner ?? `pid ${process.pid}`
  const [command, ...args] = parsed.rest
  if (!command) { console.error('usage: node scripts/heavy-lock.mjs --owner <who> [--priority high|normal|low] -- <command> [args...]  |  --status'); return 2 }
  const text = [command, ...args].join(' ')
  const stop = signal => { release(); dequeue(); process.exit(signal === 'SIGINT' ? 130 : 143) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('exit', () => { release(); dequeue() })
  await acquire({ owner, command: text, priority: priorityFor(owner, parsed.priority ?? process.env.OXESPACE_HEAVY_PRIORITY),
    log: line => console.error(`[heavy-lock] ${line}`) })
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
