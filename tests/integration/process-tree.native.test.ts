import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'
import { resolveExecutable, TerminalManager } from '../../electron/main/services/terminal.service'

/*
 * BE-M-08 on the real OS: a terminal (or agent) whose child starts a grandchild that ignores SIGTERM, SIGHUP and
 * SIGINT and leaves the session/console (`detached`: setsid on Linux/macOS, DETACHED_PROCESS on Windows), which
 * starts one more. After the pane closes, the app quits, or the pane restarts, no process of that tree may live.
 * Runs on every OS (CI: Windows and Linux); nothing here needs a model, a network or a real agent CLI. The tree runs
 * on the system `node` from PATH, never on process.execPath: under `npm run test:electron` that is the Electron
 * binary, a GUI-subsystem program that the bundled ConPTY reports as exited at once, and one this suite must not
 * launch. A shell, what a pane really runs, is a console program like node.
 */
const NODE = resolveExecutable('node')

const TREE_SCRIPT = String.raw`
const { spawn } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const [pidFile, depthText] = process.argv.slice(2)
const depth = Number(depthText)
if (depth > 0) for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) { try { process.on(signal, () => {}) } catch {} }
appendFileSync(pidFile, process.pid + '\n')
if (depth < 2) {
  const child = spawn(process.execPath, [__filename, pidFile, String(depth + 1)], {
    detached: depth === 0, stdio: 'ignore', windowsHide: true, env: process.env
  })
  child.unref()
}
setInterval(() => {}, 1000)
`

const roots: string[] = []
const spawned = new Set<number>()

function fixture(): { script: string; pidFile: string; cwd: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'oxe-process-tree-'))
  roots.push(cwd)
  const script = join(cwd, 'tree.cjs')
  writeFileSync(script, TREE_SCRIPT)
  return { script, pidFile: join(cwd, 'pids.txt'), cwd }
}

function isAlive(pid: number): boolean {
  if (process.platform === 'linux') {
    // A zombie already died; it only waits to be reaped.
    try { if (/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false } catch { return false }
  }
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

async function waitFor<T>(read: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

async function treeOf(pidFile: string): Promise<number[]> {
  const pids = await waitFor(() => {
    if (!existsSync(pidFile)) return undefined
    const found = readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number)
    return found.length >= 3 && found.every(isAlive) ? found : undefined
  }, 20000, 'the three processes of the tree')
  for (const pid of pids) spawned.add(pid)
  return pids
}

async function expectAllGone(pids: number[]): Promise<void> {
  await waitFor(() => pids.every(pid => !isAlive(pid)) ? true : undefined, 10000, `the tree to end (alive: ${pids.filter(isAlive).join(', ')})`)
    .catch(() => undefined)
  expect(pids.filter(isAlive), 'processes of the closed tree still alive').toEqual([])
}

afterEach(() => {
  // Never leak a test process, even when an assertion failed.
  for (const pid of spawned) {
    if (!isAlive(pid)) continue
    try {
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      else process.kill(pid, 'SIGKILL')
    } catch { /* gone */ }
  }
  spawned.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function terminalWith(script: string, pidFile: string, cwd: string) {
  const db = openInMemoryDatabase()
  const paneId = 'oxequery-shell:5f0c2f4e-6b7a-4c1e-9d3b-0a1b2c3d4e5f'
  const shell = { file: NODE, args: [script, pidFile, '0'] }
  const manager = new TerminalManager(db, { env: { ...process.env }, oxeQueryShell: id => id === paneId ? shell : undefined })
  const input = { workspaceId: 'oxequery', paneId, disableRtk: true, cols: 80, rows: 24 }
  return { manager, input, db, cwd }
}

describe('closing a terminal or agent ends its whole process tree (BE-M-08)', () => {
  test('pane close: no process of the tree survives, including a detached grandchild ignoring SIGTERM', async () => {
    const { script, pidFile, cwd } = fixture()
    const { manager, input, db } = terminalWith(script, pidFile, cwd)
    try {
      await manager.start(input)
      const pids = await treeOf(pidFile)
      manager.stop({ paneId: input.paneId })
      manager.stop({ paneId: input.paneId }) // idempotent
      await expectAllGone(pids)
    } finally { manager.stopAll(); db.close() }
  }, 45000)

  test('app quit (stopAll): the tree ends', async () => {
    const { script, pidFile, cwd } = fixture()
    const { manager, input, db } = terminalWith(script, pidFile, cwd)
    try {
      await manager.start(input)
      const pids = await treeOf(pidFile)
      manager.stopAll()
      await expectAllGone(pids)
    } finally { db.close() }
  }, 45000)

  test('restart: the old tree ends and the new one starts', async () => {
    const { script, pidFile, cwd } = fixture()
    const { manager, input, db } = terminalWith(script, pidFile, cwd)
    try {
      await manager.start(input)
      const first = await treeOf(pidFile)
      writeFileSync(pidFile, '')
      await manager.restart({ paneId: input.paneId })
      await expectAllGone(first)
      const second = await treeOf(pidFile)
      expect(second.some(pid => first.includes(pid))).toBe(false)
      manager.stopAll()
      await expectAllGone(second)
    } finally { manager.stopAll(); db.close() }
  }, 60000)

  test('agent conversation close (also how a delegation ends): the tree ends', async () => {
    const { script, pidFile, cwd } = fixture()
    const transport = new AgentProcessTransport('node', [script, pidFile, '0'], cwd)
    const pids = await treeOf(pidFile)
    await transport.close()
    await transport.close() // idempotent
    await expectAllGone(pids)
  }, 45000)
})
