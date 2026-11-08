// Frozen acceptance test for 1.5.0 A18 (OXE program, phase F4): each pane's branch, with "switched from X" when it
// changes (T73), and the passive shell cwd from OSC 7 / 633 / 9;9 / 1337 (T79), validated like a reported cwd.
// Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A18 (ccr-t71-task-places.md §6 "Terminal tab") and DESIGN's
// 1.5.0-f4-design.md U4.4 (Pane branch, OSC membership).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ShellCwdScanner, SHELL_CWD_MAX_PENDING } from '../../../electron/main/services/terminal/shell-cwd'
import { PaneBranchTracker } from '../../../electron/main/services/terminal/pane-branch'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { removeTempDir } from '../../helpers/removeTempDir'

vi.setConfig({ testTimeout: 30_000 })
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) { try { removeTempDir(dir) } catch { /* temp */ } } })

const ESC = '\u001b'
const BEL = '\u0007'
const ST = `${ESC}\\`
const win = process.platform === 'win32'
/** A local absolute folder, and its file:// form. */
const local = win ? 'C:\\Users\\dev\\repo tree' : '/home/dev/repo tree'
const fileUrl = (host: string): string => win ? `file://${host}/C:/Users/dev/repo%20tree` : `file://${host}/home/dev/repo%20tree`

describe('A18 · shell cwd from OSC sequences', () => {
  test('A18: OSC 7 file:// with an empty, localhost or this machine\'s host, ended by BEL or ST', () => {
    for (const host of ['', 'localhost', hostname()]) {
      expect(new ShellCwdScanner().push(`prompt ${ESC}]7;${fileUrl(host)}${BEL}$ `)).toBe(resolve(local))
      expect(new ShellCwdScanner().push(`${ESC}]7;${fileUrl(host)}${ST}`)).toBe(resolve(local))
    }
  })

  test('A18: VS Code\'s OSC 633 P;Cwd=, Windows Terminal\'s OSC 9;9 and iTerm2\'s OSC 1337 CurrentDir=', () => {
    expect(new ShellCwdScanner().push(`${ESC}]633;P;Cwd=${local}${BEL}`)).toBe(resolve(local))
    expect(new ShellCwdScanner().push(`${ESC}]9;9;"${local}"${BEL}`)).toBe(resolve(local))
    expect(new ShellCwdScanner().push(`${ESC}]9;9;${local}${ST}`)).toBe(resolve(local))
    expect(new ShellCwdScanner().push(`${ESC}]1337;CurrentDir=${local}${BEL}`)).toBe(resolve(local))
  })

  test('A18: the newest cwd in a chunk wins; a chunk without one returns null', () => {
    const scanner = new ShellCwdScanner()
    const other = win ? 'D:\\work' : '/srv/work'
    expect(scanner.push(`${ESC}]1337;CurrentDir=${local}${BEL} ls ${ESC}]1337;CurrentDir=${other}${BEL}`)).toBe(resolve(other))
    expect(scanner.push('plain output, no sequence\r\n')).toBeNull()
  })

  test('A18: a sequence split across chunks is read once it completes', () => {
    const scanner = new ShellCwdScanner()
    const sequence = `${ESC}]633;P;Cwd=${local}${BEL}`
    expect(scanner.push(`out ${sequence.slice(0, 9)}`)).toBeNull()
    expect(scanner.push(sequence.slice(9))).toBe(resolve(local))
  })

  test('A18: a remote host, a relative path, a UNC share, a NUL or an over-long value is ignored', () => {
    const scanner = new ShellCwdScanner()
    expect(scanner.push(`${ESC}]7;${fileUrl('build-server.example')}${BEL}`)).toBeNull()
    expect(scanner.push(`${ESC}]1337;CurrentDir=relative/dir${BEL}`)).toBeNull()
    expect(scanner.push(`${ESC}]633;P;Cwd=\\\\server\\share\\x${BEL}`)).toBeNull()
    expect(scanner.push(`${ESC}]1337;CurrentDir=${local}\u0000x${BEL}`)).toBeNull()
    expect(scanner.push(`${ESC}]1337;CurrentDir=${resolve(local)}${'a'.repeat(4100)}${BEL}`)).toBeNull()
    // The same scanner still reads a valid value afterwards.
    expect(scanner.push(`${ESC}]1337;CurrentDir=${local}${BEL}`)).toBe(resolve(local))
  })

  test('A18: an unterminated sequence never grows the pending buffer past its cap', () => {
    const scanner = new ShellCwdScanner()
    scanner.push(`${ESC}]7;file:///`)
    for (let i = 0; i < 50; i++) expect(scanner.push('x'.repeat(1000))).toBeNull()
    expect(scanner.pendingLength()).toBeLessThanOrEqual(SHELL_CWD_MAX_PENDING)
    // It recovers: the next complete sequence is read.
    expect(scanner.push(`${BEL}${ESC}]1337;CurrentDir=${local}${BEL}`)).toBe(resolve(local))
  })
})

describe('A18 · each pane\'s branch', () => {
  function repo(): string {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f4-pane-')))
    dirs.push(dir)
    const run = (...args: string[]) => execFileSync('git', args, { cwd: dir })
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'e@x'); run('config', 'user.name', 'E')
    writeFileSync(join(dir, 'a.txt'), 'a\n'); run('add', '.'); run('commit', '-qm', 'a')
    run('branch', 'feature')
    return dir
  }

  test('A18: a pane starts on its branch; after a switch it reports the new branch and where it started', async () => {
    const dir = repo()
    const tracker = new PaneBranchTracker()
    expect(await tracker.track('p1', dir)).toEqual({ branch: 'main', startedOn: 'main', switched: false })
    execFileSync('git', ['switch', '-q', 'feature'], { cwd: dir })
    expect(await tracker.refresh('p1')).toEqual({ branch: 'feature', startedOn: 'main', switched: true })
    expect(tracker.get('p1')).toEqual({ branch: 'feature', startedOn: 'main', switched: true })
    execFileSync('git', ['switch', '-q', 'main'], { cwd: dir })
    expect(await tracker.refresh('p1')).toEqual({ branch: 'main', startedOn: 'main', switched: false })
  })

  test('A18: a new cwd from the shell moves the pane to that checkout\'s branch, keeping where it started', async () => {
    const dir = repo()
    const other = repo()
    execFileSync('git', ['switch', '-q', 'feature'], { cwd: other })
    const tracker = new PaneBranchTracker()
    await tracker.track('p1', dir)
    expect(await tracker.refresh('p1', other)).toEqual({ branch: 'feature', startedOn: 'main', switched: true })
  })

  test('A18: a folder outside any repository, or a detached HEAD, has no branch', async () => {
    const plain = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f4-plain-')))
    dirs.push(plain)
    mkdirSync(join(plain, 'sub'))
    const tracker = new PaneBranchTracker()
    expect(await tracker.track('p2', join(plain, 'sub'))).toEqual({ branch: null, startedOn: null, switched: false })
    expect(await tracker.track('p4', repo())).toEqual({ branch: 'main', startedOn: 'main', switched: false })
    const dir = repo()
    execFileSync('git', ['switch', '-q', '--detach'], { cwd: dir })
    expect(await tracker.track('p3', dir)).toEqual({ branch: null, startedOn: null, switched: false })
    tracker.forget('p3')
    expect(tracker.get('p3')).toBeNull()
  })

  test('A18: the pane branch is read and pushed over IPC, excluded from MCP', () => {
    expect(IPC_CHANNELS.terminal).toMatchObject({ branch: 'terminal:branch', branchChanged: 'terminal:branch-changed' })
    for (const key of ['terminal.branch', 'terminal.branchChanged']) {
      const found = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(key))
      expect(found, key).toHaveLength(1)
      expect(found[0], key).toHaveProperty('excluded')
    }
  })
})
