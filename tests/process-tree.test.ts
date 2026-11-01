import { describe, expect, test, vi } from 'vitest'
import { descendantsFromPs, killProcessTree, terminatePty, type ProcessTreeDeps } from '../electron/main/utils/process-tree'

/** A fake process table: `alive` holds pids and `-pgid` groups; signals remove them per the rules given. */
function fakeOs(platform: NodeJS.Platform, alive: Set<number>, ps = '', ignoresTerm = new Set<number>()) {
  const calls: Array<[number, NodeJS.Signals | 0]> = []
  const runs: Array<[string, string[]]> = []
  const deps: Partial<ProcessTreeDeps> = {
    platform,
    graceMs: 120,
    run: async (file, args) => { runs.push([file, args]); return file === 'ps' ? ps : '' },
    kill: (pid, signal) => {
      calls.push([pid, signal])
      if (!alive.has(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      if (signal === 'SIGKILL' || (signal === 'SIGTERM' && !ignoresTerm.has(pid))) alive.delete(pid)
    }
  }
  return { deps, calls, runs }
}

describe('process tree cleanup (BE-M-08)', () => {
  test('reads descendants from ps output, across job groups, closest first', () => {
    const ps = ' 1 0\n 100 1\n 101 100\n 102 101\n 103 101\n 200 1\n 104 102\n garbage\n'
    expect(descendantsFromPs(ps, 100)).toEqual([101, 102, 103, 104])
    expect(descendantsFromPs(ps, 999)).toEqual([])
  })

  test('POSIX: SIGTERM to the group and every descendant, then SIGKILL to what ignored it', async () => {
    // 100 leads the group; 102 runs in a job group of its own and ignores SIGTERM.
    const alive = new Set([100, -100, 101, 102])
    const os = fakeOs('linux', alive, '100 1\n101 100\n102 101\n', new Set([102]))
    await killProcessTree(100, os.deps)
    expect(alive.size).toBe(0)
    expect(os.calls).toContainEqual([-100, 'SIGTERM'])
    expect(os.calls).toContainEqual([102, 'SIGTERM'])
    expect(os.calls).toContainEqual([102, 'SIGKILL'])
    expect(os.runs).toEqual([['ps', ['-A', '-o', 'pid=,ppid=']]])
  })

  test('POSIX: settles early when everything left on SIGTERM, without SIGKILL', async () => {
    const alive = new Set([300, -300, 301])
    const os = fakeOs('darwin', alive, '300 1\n301 300\n')
    const started = Date.now()
    await killProcessTree(300, os.deps)
    expect(Date.now() - started).toBeLessThan(110)
    expect(os.calls.some(([, signal]) => signal === 'SIGKILL')).toBe(false)
  })

  test('POSIX: a failing ps still kills the group', async () => {
    const alive = new Set([400, -400])
    const os = fakeOs('linux', alive, '')
    await killProcessTree(400, os.deps)
    expect(alive.size).toBe(0)
  })

  test('Windows: one taskkill /T /F on the root', async () => {
    const os = fakeOs('win32', new Set())
    await killProcessTree(500, os.deps)
    expect(os.runs).toEqual([['taskkill.exe', ['/pid', '500', '/T', '/F']]])
    expect(os.calls).toEqual([])
  })

  test('idempotent: concurrent calls share one kill; invalid pids and our own pid are ignored', async () => {
    const os = fakeOs('win32', new Set())
    await Promise.all([killProcessTree(600, os.deps), killProcessTree(600, os.deps)])
    expect(os.runs).toHaveLength(1)
    await killProcessTree(undefined, os.deps)
    await killProcessTree(0, os.deps)
    await killProcessTree(-5, os.deps)
    await killProcessTree(process.pid, os.deps)
    expect(os.runs).toHaveLength(1)
  })

  test('never throws, even when every primitive does', async () => {
    const deps: Partial<ProcessTreeDeps> = {
      platform: 'linux', graceMs: 10,
      run: async () => { throw new Error('no ps') },
      kill: () => { throw new Error('boom') }
    }
    await expect(killProcessTree(700, deps)).resolves.toBeUndefined()
    await expect(terminatePty({ pid: 701, kill: () => { throw new Error('gone') } }, deps)).resolves.toBeUndefined()
    await expect(terminatePty(null, deps)).resolves.toBeUndefined()
  })

  test('Windows PTY: the tree goes before the pseudo console is released', async () => {
    const order: string[] = []
    const deps: Partial<ProcessTreeDeps> = {
      platform: 'win32',
      run: async (file) => { order.push(file); return '' },
      kill: () => {}
    }
    const pty = { pid: 800, kill: vi.fn(() => { order.push('pty.kill') }) }
    const done = terminatePty(pty, deps)
    expect(pty.kill).not.toHaveBeenCalled()
    await done
    expect(order).toEqual(['taskkill.exe', 'pty.kill'])
  })

  test('POSIX PTY: released at once, the tree follows', async () => {
    const alive = new Set([900, -900])
    const os = fakeOs('linux', alive, '900 1\n')
    const pty = { pid: 900, kill: vi.fn() }
    const done = terminatePty(pty, os.deps)
    expect(pty.kill).toHaveBeenCalledTimes(1)
    await done
    expect(alive.size).toBe(0)
  })
})
