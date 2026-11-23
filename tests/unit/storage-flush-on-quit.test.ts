// @vitest-environment node
/**
 * OXE-396: Chromium writes the window's localStorage to disk a few seconds after a change. A process that ends before
 * then (an abort on quit, OXE-392, and sometimes a plain quit) lost everything written since, so a restart came back
 * without the side-by-side view (run 45076001890: ended 1 s after the change, 10/10 lost; the same with a flush first,
 * 0/10). The quit drain flushes the app's session first and waits a short, bounded grace with its other work.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushStorage, STORAGE_FLUSH_GRACE_MS } from '../../electron/main/storage-flush'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('flushStorage', () => {
  it('asks the session to write its DOM storage at once, and settles only after the grace', async () => {
    const session = { flushStorageData: vi.fn() }
    let settled = false
    const done = flushStorage(session).then(() => { settled = true })
    expect(session.flushStorageData).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(STORAGE_FLUSH_GRACE_MS - 1)
    expect(settled, 'still waiting for the write to land').toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(settled).toBe(true)
  })

  it('is bounded: a session that throws, or has no storage, still lets the quit go on within the grace', async () => {
    let settled = 0
    void flushStorage({ flushStorageData: () => { throw new Error('gone') } }).then(() => { settled++ })
    void flushStorage(null).then(() => { settled++ })
    await vi.advanceTimersByTimeAsync(STORAGE_FLUSH_GRACE_MS)
    expect(settled).toBe(2)
  })

  it('keeps the grace short: a quit waits a fraction of a second, never seconds', () => {
    expect(STORAGE_FLUSH_GRACE_MS).toBeGreaterThan(0)
    expect(STORAGE_FLUSH_GRACE_MS).toBeLessThanOrEqual(500)
  })
})

describe('the quit drain', () => {
  const index = readFileSync(join(process.cwd(), 'electron/main/index.ts'), 'utf8').replace(/\r\n/g, '\n')
  const drain = index.slice(index.indexOf('let memoryShutdownStarted'), index.indexOf("app.once('before-quit', () => {\n    for (const filePath"))

  it('is the one before-quit handler every normal quit goes through (window close, app quit, relaunch)', () => {
    expect(drain).toMatch(/app\.on\('before-quit', \(event\) => \{/)
    expect(index).toMatch(/app\.on\('window-all-closed', \(\) => \{[\s\S]{0,200}app\.quit\(\)/)
  })

  it("flushes the app's session in the same settled wait whose end lets the quit go on", () => {
    const wait = drain.match(/Promise\.allSettled\(\[([^\]]*)\]\)([\s\S]*?)\.finally\(\(\) => \{([\s\S]*?)\n {4}\}\)/)
    expect(wait, 'the drain waits with Promise.allSettled').not.toBeNull()
    expect(wait![1]).toMatch(/flushStorage\(session\.defaultSession\)/)
    expect(wait![3]).toMatch(/\bquit\(\)/)
  })
})
