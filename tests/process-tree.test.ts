import { win32 } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { MAX_PLAN_PIDS, descendantsFromPs, killProcessTree, planPosixKill, terminatePty, type ProcessTreeDeps } from '../electron/main/utils/process-tree'

/** A fake process table: `alive` holds pids and `-pgid` groups; signals remove them per the rules given. */
function fakeOs(platform: NodeJS.Platform, alive: Set<number>, ps = '', ignoresTerm = new Set<number>()) {
  const calls: Array<[number, NodeJS.Signals | 0]> = []
  const runs: Array<[string, string[]]> = []
  const deps: Partial<ProcessTreeDeps> = {
    platform,
    graceMs: 120,
    run: async (file, args) => { runs.push([file, args]); return file === '/bin/ps' ? ps : '' },
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
    const ps = ' 1 0 1\n 100 1 100\n 101 100 100\n 102 101 102\n 103 101 102\n 200 1 200\n 104 102 102\n garbage\n'
    expect(descendantsFromPs(ps, 100)).toEqual([101, 102, 103, 104])
    expect(descendantsFromPs(ps, 999)).toEqual([])
  })

  test('POSIX: SIGTERM to the group and every descendant, then SIGKILL to what ignored it', async () => {
    // 100 leads the group; 102 runs in a job group of its own and ignores SIGTERM.
    const alive = new Set([100, -100, 101, 102])
    const os = fakeOs('linux', alive, '100 1 100\n101 100 100\n102 101 102\n', new Set([102]))
    await killProcessTree(100, os.deps)
    expect(alive.size).toBe(0)
    expect(os.calls).toContainEqual([-100, 'SIGTERM'])
    expect(os.calls).toContainEqual([102, 'SIGTERM'])
    expect(os.calls).toContainEqual([102, 'SIGKILL'])
    // A second snapshot before SIGKILL, since something survived SIGTERM.
    expect(os.runs).toEqual([['/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=']], ['/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=']]])
  })

  test('POSIX: SIGKILL goes only to what a fresh ps still lists with its first group', async () => {
    // 101 and 102 ignore SIGTERM. By the SIGKILL, the root is gone, 102 was reparented to init (same group), and
    // 101's pid shows up in another group: a reused pid, never signalled again.
    const alive = new Set([100, -100, 101, 102])
    const snapshots = ['100 1 100\n101 100 100\n102 101 102\n', '101 1 5555\n102 1 102\n']
    const os = fakeOs('linux', alive, '', new Set([101, 102]))
    os.deps.run = async (file, args) => { os.runs.push([file, args]); return snapshots.shift() ?? '' }
    await killProcessTree(100, os.deps)
    const killed = os.calls.filter(([, signal]) => signal === 'SIGKILL').map(([pid]) => pid)
    expect(killed).toEqual([102])
    expect(os.runs).toHaveLength(2)
  })

  test('POSIX: settles early when everything left on SIGTERM, without SIGKILL', async () => {
    const alive = new Set([300, -300, 301])
    const os = fakeOs('darwin', alive, '300 1 300\n301 300 300\n')
    const started = Date.now()
    await killProcessTree(300, os.deps)
    expect(Date.now() - started).toBeLessThan(110)
    expect(os.calls.some(([, signal]) => signal === 'SIGKILL')).toBe(false)
  })

  test('POSIX: a failing ps still ends the root, but never signals a group it could not verify', async () => {
    const alive = new Set([400, -400])
    const os = fakeOs('linux', alive, '')
    await killProcessTree(400, os.deps)
    expect(alive.has(400)).toBe(false)
    expect(os.calls.some(([pid]) => pid < 0)).toBe(false)
  })

  test('Windows: the parent of this process and pid 4 (System) are refused before taskkill', async () => {
    const os = fakeOs('win32', new Set())
    os.deps.self = { pid: 900, ppid: 800 }
    await killProcessTree(800, os.deps)
    await killProcessTree(4, os.deps)
    await killProcessTree(process.ppid, os.deps)
    expect(os.runs).toEqual([])
    await killProcessTree(1234, os.deps)
    expect(os.runs).toHaveLength(1)
  })

  test('Windows: one taskkill /T /F on the root, by its absolute System32 path', async () => {
    const os = fakeOs('win32', new Set())
    await killProcessTree(500, os.deps)
    const taskkill = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    expect(os.runs).toEqual([[taskkill, ['/pid', '500', '/T', '/F']]])
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
    expect(order).toEqual([expect.stringMatching(/[\\/]System32[\\/]taskkill\.exe$/i), 'pty.kill'])
  })

  test('POSIX PTY: the tree (its ps snapshot included) goes before the PTY is released', async () => {
    const alive = new Set([900, -900, 901])
    const order: string[] = []
    const os = fakeOs('linux', alive, '900 1 900\n901 900 900\n')
    const run = os.deps.run!
    os.deps.run = async (file, args, timeout) => { order.push('ps'); return run(file, args, timeout) }
    const pty = { pid: 900, kill: vi.fn(() => { order.push('pty.kill') }) }
    const done = terminatePty(pty, os.deps)
    expect(pty.kill).not.toHaveBeenCalled()
    await done
    expect(order).toEqual(['ps', 'pty.kill'])
    expect(alive.size).toBe(0)
  })
})

/*
 * A CI runner as `ps -A -o pid=,ppid=,pgid=` sees it, with this test process as the vitest worker (900). A fake PTY
 * with pid 1 (tests/integration/pane-resume.test.ts) once reached the real kill on Linux: kill(-1, SIGTERM) signals
 * every process the user owns, and every orphan is a ps descendant of init, so the runner lost its Runner.Worker.
 */
const RUNNER_PS = [
  '   1    0    1', // init
  ' 500    1  500', // Runner.Listener
  ' 600  500  600', // Runner.Worker
  ' 700  600  700', // the step's shell
  ' 800  700  700', // npm / vitest main
  ' 900  800  700', // this vitest worker
  '1000    1 1000', // an unrelated daemon, reparented to init
  '1100  900 1100', // a PTY this process started (setsid)
  '1101 1100 1100', //   its shell's child
  '1102 1101 1102', //   a job in a group of its own
  '1200  900  700', // a child of ours that stayed in our group
  '1300  900 1300', // a detached child of ours (the conversation transport's agent)
  '1301 1300 1300'  //   its child
].join('\n') + '\n'
const SELF = { pid: 900, ppid: 800 }
const ANCESTRY = [1, 500, 600, 700, 800, 900]

function recordingKill() {
  const calls: Array<[number, NodeJS.Signals | 0]> = []
  const deps: Partial<ProcessTreeDeps> = {
    platform: 'linux', self: SELF, graceMs: 30,
    run: async () => RUNNER_PS,
    // Everything "exists" and ignores signals, so every signal the plan allows is sent, SIGKILL included.
    kill: (pid, signal) => { calls.push([pid, signal]) }
  }
  return { deps, calls }
}

describe('process tree cleanup never reaches beyond the tree it was asked to end', () => {
  test('pid 0, 1, negative, non-integer, this process and its ancestors: nothing is signalled, ps is not even read', async () => {
    for (const pid of [0, 1, -1, -700, 1.5, Number.NaN, ...ANCESTRY]) {
      const { deps, calls } = recordingKill()
      await killProcessTree(pid, deps)
      expect(calls, String(pid)).toEqual([])
    }
  })

  test('a PTY with pid 1 is released without a single signal', async () => {
    const { deps, calls } = recordingKill()
    const pty = { pid: 1, kill: vi.fn() }
    await terminatePty(pty, deps)
    expect(calls).toEqual([])
    expect(pty.kill).toHaveBeenCalledTimes(1)
  })

  test('the plan refuses init, every ancestor and this process, whatever ps says', () => {
    for (const root of [0, 1, -1, ...ANCESTRY]) expect(planPosixKill(RUNNER_PS, root, SELF), String(root)).toBeNull()
    // The parent is refused even without a snapshot.
    expect(planPosixKill('', SELF.ppid, SELF)).toBeNull()
  })

  test('a tree this process started: its group and verified descendants only', async () => {
    expect(planPosixKill(RUNNER_PS, 1100, SELF)).toEqual({ root: 1100, group: true, pids: [1101, 1102] })
    const { deps, calls } = recordingKill()
    await killProcessTree(1100, deps)
    const signalled = new Set(calls.map(([pid]) => pid))
    expect([...signalled].sort((a, b) => a - b)).toEqual([-1100, 1100, 1101, 1102])
    expect(calls).toContainEqual([1102, 'SIGKILL'])
  })

  test('a child left in our own group is signalled by pid, never by group', () => {
    expect(planPosixKill(RUNNER_PS, 1200, SELF)).toEqual({ root: 1200, group: false, pids: [] })
  })

  test('a group that holds a process of our ancestry is never signalled as a group', () => {
    const ps = `${RUNNER_PS}1400  900 1400\n1401 1400 1401\n`.replace(' 900  800  700', ' 900  800 1400')
    expect(planPosixKill(ps, 1400, SELF)).toEqual({ root: 1400, group: false, pids: [1401] })
  })

  test('a root missing from a non-empty snapshot (gone, reused, or cut) is not signalled at all', () => {
    expect(planPosixKill(RUNNER_PS, 4242, SELF)).toBeNull()
  })

  test('a truncated ps that cut an ancestor row: the ancestor is not in the snapshot and nothing is signalled', async () => {
    // ps ended by its timeout mid-table: the rows from 600 on (Runner.Worker, the step shell, ...) never arrived, so
    // the walk up from this process finds nothing and 600 is not shielded. It must not be signalled anyway.
    const truncated = RUNNER_PS.slice(0, RUNNER_PS.indexOf(' 600  500') + 6)
    expect(truncated.endsWith('\n')).toBe(false)
    for (const root of [600, 700, 800]) expect(planPosixKill(truncated, root, SELF), String(root)).toBeNull()
    const { deps, calls } = recordingKill()
    deps.run = async () => truncated
    await killProcessTree(600, deps)
    expect(calls).toEqual([])
  })

  test('malformed lines, non-decimal numbers and an unterminated last line are ignored', () => {
    const ps = [
      '2000 900 2000',
      '2001 2000 2001',
      '2002 2000 1e2', // exponent
      '2003 2000 0x10', // hex
      '0x7d4 2000 2004', // hex pid
      '2005 2000', // two fields
      '2006 2000 2006 7', // four fields
      '-2007 2000 2007', // signed
      '2008 2000 2008' // no newline: a cut line
    ].join('\n')
    expect(planPosixKill(ps, 2000, SELF)).toEqual({ root: 2000, group: true, pids: [2001] })
    // "4 1 45" cut to "4 1 4" would claim that 4 leads its own group; the cut line is dropped, so 4 is unknown.
    expect(planPosixKill('2 1 2\n4 1 4', 4, SELF)).toBeNull()
    expect(planPosixKill('2 1 2\n4 1 45\n', 4, SELF)).toEqual({ root: 4, group: false, pids: [] })
  })

  test('a 20,000-child table is planned fast and capped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const rows = (rootPgid: number, childPgid: (pid: number) => number): string => {
        const lines = [`2000 900 ${rootPgid}`]
        for (let pid = 3000; pid < 23000; pid++) lines.push(`${pid} 2000 ${childPgid(pid)}`)
        return lines.join('\n') + '\n'
      }
      // Each child in a group of its own and the root in ours: no group to lean on, so the closest MAX_PLAN_PIDS.
      const ungrouped = rows(700, pid => pid)
      const started = performance.now()
      const plan = planPosixKill(ungrouped, 2000, SELF)
      expect(performance.now() - started).toBeLessThan(1000)
      expect(plan?.group).toBe(false)
      expect(plan?.pids).toHaveLength(MAX_PLAN_PIDS)
      expect(plan?.pids[0]).toBe(3000)
      // The root leads a verified group holding them all: the group alone.
      expect(planPosixKill(rows(2000, () => 2000), 2000, SELF)).toEqual({ root: 2000, group: true, pids: [] })
      expect(warn).toHaveBeenCalledTimes(2)
    } finally { warn.mockRestore() }
  })

  test('across every root, no signal ever reaches init, an ancestor, an unrelated process, or a group not verified', async () => {
    for (const root of [1, 500, 600, 700, 800, 900, 1000, 1100, 1101, 1200, 1300, 4242]) {
      const { deps, calls } = recordingKill()
      await killProcessTree(root, deps)
      for (const [pid] of calls) {
        expect(Math.abs(pid), `root ${root}`).toBeGreaterThanOrEqual(2)
        expect(ANCESTRY, `root ${root} signalled ${pid}`).not.toContain(Math.abs(pid))
        if (root !== 1000) expect(Math.abs(pid), `root ${root}`).not.toBe(1000)
        if (pid < 0) expect([-1000, -1100, -1300], `root ${root}`).toContain(pid)
      }
    }
  })
})
