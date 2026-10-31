// @vitest-environment node
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { isStale, readLock, release, tryTake } from '../../scripts/heavy-lock.mjs'

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

  it('runs two heavy commands one after the other, never together', async () => {
    const path = lockAt('run')
    const log = lockAt('log.txt')
    writeFileSync(log, '')
    const step = (name: string) => `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'${name}-start\\n');setTimeout(()=>{fs.appendFileSync(${JSON.stringify(log)},'${name}-end\\n')},600)`
    const run = (name: string) => new Promise<number>(resolve => {
      const child = spawn(process.execPath, [join('scripts', 'heavy-lock.mjs'), '--owner', name, '--', process.execPath, '-e', step(name)],
        { env: { ...process.env, OXESPACE_HEAVY_LOCK: path }, stdio: 'ignore' })
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
