// @vitest-environment node
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { acquire, describeLock, dequeue, enqueue, isMyTurn, isStale, priorityFor, readLock, readQueue, release, tryTake, waitForMemory } from '../../scripts/heavy-lock.mjs'

const folder = mkdtempSync(join(tmpdir(), 'oxe-heavy-lock-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))
const lockAt = (name: string) => join(folder, name)

describe('machine-wide heavy lock', () => {
  it('has no shebang, so the test runner imports it on a CRLF checkout', () => {
    expect(readFileSync(join('scripts', 'heavy-lock.mjs'), 'utf8').startsWith('#!')).toBe(false)
  })

  it('lets one holder at a time, and only the holder releases it', () => {
    const path = lockAt('one')
    expect(tryTake('first', 'npm run build', path)).toBe(true)
    expect(readLock(path)).toMatchObject({ owner: 'first', pid: process.pid, command: 'npm run build' })
    // The same process is still running, so the lock is held.
    expect(tryTake('second', 'npx tsc', path)).toBe(false)
    release(path)
    expect(existsSync(path)).toBe(false)
    expect(tryTake('second', 'npx tsc', path)).toBe(true)
    release(path)
  })

  it('takes over a lock whose holder is gone or that is too old, never a live one', () => {
    const path = lockAt('stale')
    writeFileSync(path, JSON.stringify({ owner: 'ghost', pid: 2 ** 22 + 12345, command: 'gradle', takenAt: Date.now() }))
    expect(isStale(readLock(path))).toBe(true)
    expect(tryTake('next', 'npm run build', path)).toBe(true)
    expect(readLock(path)).toMatchObject({ owner: 'next', pid: process.pid })
    release(path)
    writeFileSync(path, JSON.stringify({ owner: 'old', pid: process.pid, command: 'x', takenAt: Date.now() - 3 * 60 * 60_000 }))
    expect(isStale(readLock(path))).toBe(true)
    writeFileSync(path, 'not json')
    expect(isStale(readLock(path))).toBe(true)
    writeFileSync(path, JSON.stringify({ owner: 'alive', pid: process.pid, command: 'x', takenAt: Date.now() }))
    expect(isStale(readLock(path))).toBe(false)
    expect(tryTake('other', 'y', path)).toBe(false)
    rmSync(path)
  })

  it('waits for free memory without a cap, and 0 turns the check off', async () => {
    const readings = [0.4, 0.8, 1.6]
    let onWait = 0
    const heard: number[] = []
    expect(await waitForMemory(1, () => readings.shift() ?? 9, 1, () => { onWait++ }, (free: number) => { heard.push(free) })).toBe(2)
    expect(onWait).toBe(1)
    expect(heard).toEqual([0.4, 0.8])
    expect(await waitForMemory(1, () => 3.2, 1)).toBe(0)
    expect(await waitForMemory(0, () => 0.1, 1)).toBe(0)
  })

  it('gives each owner a priority: explicit first, else its role, else normal', () => {
    expect(priorityFor('be-mcpcore')).toBe(1)
    expect(priorityFor('hml-check-316')).toBe(2)
    expect(priorityFor('release:1.4.0')).toBe(2)
    expect(priorityFor('coord')).toBe(2)
    expect(priorityFor('hml', 'low')).toBe(0)
    expect(priorityFor('be', ' HIGH ')).toBe(2)
    // An unknown name is ignored, never trusted as a number.
    expect(priorityFor('be', '99')).toBe(1)
    expect(priorityFor(undefined)).toBe(1)
  })

  it('orders the queue by priority, then by who came first, and drops waiters that are gone', () => {
    const path = lockAt('queue')
    const now = Date.now()
    // The parent process is alive for the whole test; a PID this large is not.
    enqueue({ owner: 'earlier', pid: process.ppid, priority: 1, since: now - 1000, command: 'a', waiting: 'lock' }, path)
    enqueue({ owner: 'me', pid: process.pid, priority: 2, since: now, command: 'b', waiting: 'lock' }, path)
    enqueue({ owner: 'ghost', pid: 2 ** 22 + 12345, priority: 2, since: now - 5000, command: 'c', waiting: 'lock' }, path)
    expect(readQueue(path).map((entry: { owner: string }) => entry.owner)).toEqual(['me', 'earlier'])
    expect(existsSync(join(`${path}.queue`, `${2 ** 22 + 12345}.json`))).toBe(false)
    expect(isMyTurn(process.pid, path)).toBe(true)
    expect(isMyTurn(process.ppid, path)).toBe(false)
    // Same priority: whoever queued first goes first.
    enqueue({ owner: 'me', pid: process.pid, priority: 1, since: now, command: 'b', waiting: 'lock' }, path)
    expect(isMyTurn(process.pid, path)).toBe(false)
    // A waiter still waiting for memory gives no turn away and takes none.
    enqueue({ owner: 'earlier', pid: process.ppid, priority: 2, since: now - 1000, command: 'a', waiting: 'memory', free: 0.2, need: 1 }, path)
    expect(isMyTurn(process.pid, path)).toBe(true)
    expect(describeLock(null, now, readQueue(path))).toBe(`free\n  1. earlier (pid ${process.ppid}, high) waiting for memory, 0.2 GB free, need 1: a\n  2. me (pid ${process.pid}, normal) waiting for the lock: b`)
    dequeue(process.ppid, path)
    dequeue(process.pid, path)
    expect(readQueue(path)).toEqual([])
  })

  it('waits for memory without the lock, and only then takes it', async () => {
    const path = lockAt('preflight')
    const readings = [0.3, 0.5, 2, 2]
    const heldWhileLow: unknown[] = []
    const log: string[] = []
    await acquire({ owner: 'be-test', command: 'npm run build', priority: 1, path, floor: 1, pollMs: 1, log: (line: string) => log.push(line),
      read: () => { const free = readings.shift() ?? 2; if (free < 1) heldWhileLow.push(readLock(path)); return free } })
    expect(heldWhileLow).toEqual([null, null])
    expect(readLock(path)).toMatchObject({ owner: 'be-test', pid: process.pid })
    expect(log).toEqual(['waiting: 0.3 GB free, 1 GB needed (not holding the lock)', 'waiting: 0.5 GB free, 1 GB needed (not holding the lock)'])
    // Holding the lock, it has left the queue.
    expect(readQueue(path)).toEqual([])
    release(path)
  })

  it('gives the lock straight back when memory drops right after taking it', async () => {
    const path = lockAt('drop')
    // Preflight ok, then low right after the lock, then ok twice.
    const readings = [2, 0.4, 2, 2]
    const lockAtThirdRead: unknown[] = []
    const log: string[] = []
    let reads = 0
    await acquire({ owner: 'be-test', command: 'x', priority: 1, path, floor: 1, pollMs: 1, log: (line: string) => log.push(line),
      read: () => { if (++reads === 3) lockAtThirdRead.push(readLock(path)); return readings.shift() ?? 2 } })
    expect(log).toEqual(['gave the lock back: 0.4 GB free right after taking it, 1 GB needed'])
    expect(lockAtThirdRead).toEqual([null])
    expect(readLock(path)).toMatchObject({ owner: 'be-test' })
    release(path)
  })

  it('lets a higher-priority waiter go first, even with the lock free', async () => {
    const path = lockAt('priority')
    enqueue({ owner: 'hml', pid: process.ppid, priority: 2, since: Date.now(), command: 'e2e', waiting: 'lock' }, path)
    const log: string[] = []
    let done = false
    const taking = acquire({ owner: 'be-test', command: 'x', priority: 1, path, floor: 0, pollMs: 5, log: (line: string) => log.push(line) }).then(() => { done = true })
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(done).toBe(false)
    expect(readLock(path)).toBeNull()
    expect(log).toEqual(['waiting: hml is ahead in the queue'])
    dequeue(process.ppid, path)
    await taking
    expect(readLock(path)).toMatchObject({ owner: 'be-test' })
    release(path)
  })

  it('never takes the lock while memory is missing, so another holder gets in and --status shows the waiter', async () => {
    const path = lockAt('starved')
    const child = spawn(process.execPath, [join('scripts', 'heavy-lock.mjs'), '--owner', 'starved', '--priority', 'high', '--', process.execPath, '-e', '1'],
      { env: { ...process.env, OXESPACE_HEAVY_LOCK: path, OXESPACE_HEAVY_MIN_FREE_GB: '100000', OXESPACE_HEAVY_POLL_MS: '20' } })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    try {
      await expect.poll(() => stderr, { timeout: 20_000, interval: 50 }).toContain('(not holding the lock)')
      expect(readLock(path)).toBeNull()
      // It waits for memory, so it takes no turn from a normal command that can start.
      expect(isMyTurn(process.pid, path)).toBe(true)
      expect(tryTake('patient', 'npm run build', path)).toBe(true)
      const status = await new Promise<string>(resolve => {
        const reader = spawn(process.execPath, [join('scripts', 'heavy-lock.mjs'), '--status'], { env: { ...process.env, OXESPACE_HEAVY_LOCK: path } })
        let out = ''
        reader.stdout.on('data', chunk => { out += chunk })
        reader.on('close', () => resolve(out))
      })
      expect(status).toContain('held by patient')
      expect(status).toMatch(/1\. starved \(pid \d+, high\) waiting for memory, [\d.]+ GB free, need 100000/)
      release(path)
    } finally {
      child.kill()
    }
  }, 30_000)

  it('runs two heavy commands one after the other, never together', async () => {
    const path = lockAt('run')
    const log = lockAt('log.txt')
    writeFileSync(log, '')
    const step = (name: string) => `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'${name}-start\\n');setTimeout(()=>{fs.appendFileSync(${JSON.stringify(log)},'${name}-end\\n')},600)`
    const run = (name: string) => new Promise<number>(resolve => {
      const child = spawn(process.execPath, [join('scripts', 'heavy-lock.mjs'), '--owner', name, '--', process.execPath, '-e', step(name)],
        // The floor is off here: this checks the serialization, whatever memory the runner has.
        { env: { ...process.env, OXESPACE_HEAVY_LOCK: path, OXESPACE_HEAVY_MIN_FREE_GB: '0' }, stdio: 'ignore' })
      child.on('close', code => resolve(code ?? 1))
    })
    expect(await Promise.all([run('a'), run('b')])).toEqual([0, 0])
    const lines = readFileSync(log, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(4)
    // Each command finishes before the other starts.
    expect(lines[0].replace('-start', '')).toBe(lines[1].replace('-end', ''))
    expect(lines[2].replace('-start', '')).toBe(lines[3].replace('-end', ''))
    expect(existsSync(path)).toBe(false)
  }, 30_000)
})
