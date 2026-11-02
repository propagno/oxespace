import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NODE_EXECUTABLE } from '../helpers/node-child'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir() } }))

const { OpenInService, editorArgs, editorCandidates, editorEnv, launchDetached, parseOpenInInput, registeredWorktree, trustedExecutable } = await import('../../electron/main/services/open-in')
const { messageFromError } = await import('../../shared/messages')

let base: string
let root: string
let outside: string
let launches: Array<{ file: string; args: string[]; cwd: string }>
let reveals: string[]
let failLaunch: boolean

const EDITOR_DIR = process.platform === 'win32' ? 'C:\\fake-editors' : '/fake-editors'
const installed = new Set([join(EDITOR_DIR, 'code'), join(EDITOR_DIR, 'zed')])

function service(resolveRoot = (id: string) => (id === 'w1' ? root : null)) {
  return new OpenInService({
    platform: 'linux',
    env: { PATH: EDITOR_DIR },
    resolveRoot,
    preferenceFile: join(base, 'open-in.json'),
    isExecutable: path => installed.has(path),
    launch: async (file, args, cwd) => { if (failLaunch) throw new Error('no'); launches.push({ file, args, cwd }) },
    reveal: path => { reveals.push(path) }
  })
}

/** The C3 code a call was refused with, or the plain error's text when it wasn't a C3 refusal. */
async function refusal(call: Promise<unknown>): Promise<string> {
  try { await call } catch (cause) { return messageFromError(cause)?.code ?? `plain: ${(cause as Error).message}` }
  return 'resolved'
}

/** The whole C3 message a call was refused with; fails the test if it resolved. */
async function message(call: Promise<unknown>) {
  try { await call } catch (cause) { return messageFromError(cause) }
  throw new Error('expected a refusal')
}

const open = (input: Record<string, unknown>) => service().open({ workspaceId: 'w1', rootPath: root, target: 'vscode', ...input })

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-open-in-')))
  root = join(base, 'project')
  outside = join(base, 'outside')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(root, 'src', 'app.ts'), 'x')
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  launches = []
  reveals = []
  failLaunch = false
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('app:open-in refuses anything outside an open workspace', () => {
  it('refuses a path that climbs out of the root, as written', async () => {
    expect(await refusal(open({ path: '../outside/secret.txt' }))).toBe('app.openIn.outsideRoot')
    expect(await refusal(open({ path: join(outside, 'secret.txt') }))).toBe('app.openIn.outsideRoot')
    expect(launches).toEqual([])
  })

  it('says outsideRoot, not notFound, for a missing path outside: it never tells whether it exists', async () => {
    expect(await refusal(open({ path: '../outside/nothing-here.txt' }))).toBe('app.openIn.outsideRoot')
  })

  it('refuses a link inside the project that points outside', async () => {
    // A junction needs no privilege on Windows; on POSIX the type is ignored and it is a directory link.
    symlinkSync(outside, join(root, 'linked'), 'junction')
    expect(await refusal(open({ path: 'linked/secret.txt' }))).toBe('app.openIn.outsideRoot')
    expect(await refusal(open({ path: 'linked/secret.txt', target: 'reveal' }))).toBe('app.openIn.outsideRoot')
    expect(launches).toEqual([])
    expect(reveals).toEqual([])
  })

  it('refuses a workspace main has not registered, or a root that is not the registered one', async () => {
    expect(await refusal(service().open({ workspaceId: 'unknown', rootPath: root, path: 'src/app.ts', target: 'vscode' }))).toBe('app.openIn.outsideRoot')
    expect(await refusal(service().open({ workspaceId: 'w1', rootPath: outside, path: 'secret.txt', target: 'vscode' }))).toBe('app.openIn.outsideRoot')
  })

  it('refuses a target it does not know, before touching the path', async () => {
    for (const target of ['notepad', '--inspect', 'default', 'C:\\Windows\\System32\\cmd.exe', '', 1]) {
      expect(await refusal(open({ path: 'src/app.ts', target }))).toBe('app.openIn.unknownTarget')
    }
    expect(launches).toEqual([])
  })

  it('reports a file that no longer exists by its project-relative path', async () => {
    expect(await message(open({ path: 'src/gone.ts' }))).toEqual({ code: 'app.openIn.notFound', params: { path: join('src', 'gone.ts') } })
  })

  it('refuses an editor that is not installed, and one that fails to start', async () => {
    expect(await message(open({ path: 'src/app.ts', target: 'cursor' }))).toEqual({ code: 'app.openIn.editorMissing', params: { editor: 'Cursor' } })
    failLaunch = true
    expect(await message(open({ path: 'src/app.ts' }))).toEqual({ code: 'app.openIn.launchFailed', params: { editor: 'VS Code' } })
    expect(launches).toEqual([])
  })

  it('opens only files in an editor: a folder could run tasks an agent wrote for folder open', async () => {
    expect(await message(open({ path: 'src' }))).toEqual({ code: 'app.openIn.notAFile', params: { editor: 'VS Code' } })
    expect(await message(open({ path: '.', target: 'zed' }))).toEqual({ code: 'app.openIn.notAFile', params: { editor: 'Zed' } })
    expect(launches).toEqual([])
    await open({ path: 'src', target: 'reveal' })
    expect(reveals).toEqual([join(root, 'src')])
  })

  it('keeps malformed input a plain error, never a C3 message', async () => {
    expect(await refusal(open({ path: 'src/app.ts', line: 0 }))).toMatch(/^plain: /)
    expect(await refusal(open({ path: 'src/app.ts', line: 1.5 }))).toMatch(/^plain: /)
    expect(await refusal(open({ path: 'src/\0app.ts' }))).toMatch(/^plain: /)
    expect(await refusal(service().open('src/app.ts'))).toMatch(/^plain: /)
  })
})

describe('app:open-in starts the detected editor with an argument list', () => {
  it('opens VS Code at the line and column with --goto, from the real path, in the project root', async () => {
    await open({ path: './src/../src/app.ts', line: 42, column: 3 })
    const file = join(root, 'src', 'app.ts')
    expect(launches).toEqual([{ file: join(EDITOR_DIR, 'code'), args: ['--goto', `${file}:42:3`], cwd: root }])
  })

  it('opens at the top without a line, and Zed with file:line:col', async () => {
    await open({ path: 'src/app.ts' })
    await open({ path: 'src/app.ts', target: 'zed', line: 7 })
    const file = join(root, 'src', 'app.ts')
    expect(launches.map(launch => launch.args)).toEqual([[file], [`${file}:7:1`]])
  })

  it.runIf(process.platform !== 'win32')('POSIX: a name with ":" opens at the top, and never in Zed, which reads it as path:row', async () => {
    writeFileSync(join(root, 'src', 'x:12'), 'x')
    expect(await message(open({ path: 'src/x:12', target: 'zed' }))).toEqual({ code: 'app.openIn.launchFailed', params: { editor: 'Zed' } })
    await open({ path: 'src/x:12', line: 3 })
    expect(launches.map(launch => launch.args)).toEqual([[join(root, 'src', 'x:12')]])
  })

  it('shows a file in its folder by its real path', async () => {
    await open({ path: 'src/app.ts', target: 'reveal' })
    expect(reveals).toEqual([join(root, 'src', 'app.ts')])
  })

  it('lists only installed editors, and keeps the preference across reads', () => {
    const svc = service()
    expect(svc.targets()).toEqual({ editors: [{ id: 'vscode', name: 'VS Code' }, { id: 'zed', name: 'Zed' }], preferred: 'auto' })
    expect(svc.setPreference('zed').preferred).toBe('zed')
    expect(service().targets().preferred).toBe('zed')
    expect(() => svc.setPreference('notepad')).toThrow()
    writeFileSync(join(base, 'open-in.json'), '{not json')
    expect(service().targets().preferred).toBe('auto')
  })
})

describe('where editors are looked for', () => {
  it('Linux: only absolute PATH entries, exact names', () => {
    const env = { PATH: ['/usr/bin', '.', '', 'relative/bin', '/opt/zed/bin'].join(process.platform === 'win32' ? ';' : ':') }
    const candidates = editorCandidates('zed', 'linux', env)
    expect(candidates.every(path => path.startsWith(join('/usr/bin')) || path.startsWith(join('/opt/zed/bin')))).toBe(true)
    expect(candidates.map(path => path.split(/[\\/]/).pop())).toEqual(['zed', 'zeditor', 'zed', 'zeditor'])
  })

  it('Windows: the fixed install folders, never PATH', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local', ProgramFiles: 'C:\\Program Files', PATH: 'C:\\evil' }
    const candidates = editorCandidates('vscode', 'win32', env)
    expect(candidates.length).toBe(2)
    expect(candidates.every(path => path.endsWith('Code.exe') && !path.includes('evil'))).toBe(true)
  })

  it('macOS: none yet', () => {
    expect(editorCandidates('vscode', 'darwin', { PATH: '/usr/local/bin' })).toEqual([])
  })

  it.runIf(process.platform !== 'win32')('POSIX: an editor anyone could have planted is not one', () => {
    const bin = join(base, 'bin')
    mkdirSync(bin)
    const editor = join(bin, 'code')
    writeFileSync(editor, String.raw`#!/bin/sh` + '\n')
    chmodSync(editor, 0o755)
    chmodSync(bin, 0o755)
    expect(trustedExecutable(editor, 'linux')).toBe(true)
    // Someone else's file, a file others can rewrite, a folder others can write to without the sticky bit.
    expect(trustedExecutable(editor, 'linux', 999_999)).toBe(process.getuid?.() === 0)
    chmodSync(editor, 0o757)
    expect(trustedExecutable(editor, 'linux')).toBe(false)
    chmodSync(editor, 0o755)
    chmodSync(bin, 0o777)
    expect(trustedExecutable(editor, 'linux')).toBe(false)
    chmodSync(bin, 0o1777)
    expect(trustedExecutable(editor, 'linux')).toBe(true)
    chmodSync(bin, 0o755)
  })

  it('Windows: a file is enough, never a folder', () => {
    expect(trustedExecutable(join(root, 'src', 'app.ts'), 'win32')).toBe(true)
    expect(trustedExecutable(join(root, 'src'), 'win32')).toBe(false)
    expect(trustedExecutable(join(root, 'missing.exe'), 'win32')).toBe(false)
  })

  it('builds the arguments for each editor', () => {
    expect(editorArgs('vscode', '/p/a.ts')).toEqual(['/p/a.ts'])
    expect(editorArgs('cursor', '/p/a.ts', 3)).toEqual(['--goto', '/p/a.ts:3:1'])
    expect(editorArgs('zed', '/p/a.ts', 3, 9)).toEqual(['/p/a.ts:3:9'])
    // A name with ":" would be misread as file:line: it opens at the top instead.
    expect(editorArgs('vscode', '/p/a:b.ts', 3)).toEqual(['/p/a:b.ts'])
    expect(editorArgs('zed', '/p/a:b.ts', 3)).toEqual(['/p/a:b.ts'])
    // A Windows drive's colon is not a name with ":".
    expect(editorArgs('vscode', String.raw`C:\p\a.ts`, 3)).toEqual(['--goto', String.raw`C:\p\a.ts:3:1`])
  })

  it('never hands an editor the run-as-Node switch, Node options or OXESpace variables', () => {
    const env = editorEnv({ PATH: '/bin', electron_run_as_node: '1', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require x', OXESPACE_MCP_TOKEN: 't', HOME: '/h' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' })
  })

  it('parses a valid input as it is', () => {
    expect(parseOpenInInput({ workspaceId: 'w', rootPath: '/r', path: 'a', line: 2, column: 4, target: 'reveal', extra: 1 }))
      .toEqual({ workspaceId: 'w', rootPath: '/r', path: 'a', line: 2, column: 4, target: 'reveal' })
  })
})

describe('launchDetached', () => {
  it('passes every argument as it is: no shell reads them', async () => {
    const out = join(base, 'argv.json')
    const tricky = ['a & echo hacked', '$(whoami)', '`id`', '%PATH%', '"quoted" arg', 'x | y']
    const script = 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))'
    await launchDetached(NODE_EXECUTABLE, ['-e', script, out, ...tricky], base, process.env)
    for (let waited = 0; !existsSync(out) && waited < 10_000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(tricky)
  })

  it('rejects when the executable is missing', async () => {
    await expect(launchDetached(join(base, 'no-such-editor'), [], base, process.env)).rejects.toThrow()
  })
})

describe('registeredWorktree: the worktree of a conversation opens, a folder that only claims to be one does not', () => {
  // Only the repository's own `git worktree add` writes both directions of the link.
  function repoWithWorktree(): { project: string; worktree: string } {
    const project = join(base, 'repo')
    const worktree = join(base, 'repo-wt')
    mkdirSync(project)
    const git = (...args: string[]): void => { execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: project, stdio: 'ignore' }) }
    git('init', '-q')
    git('commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', worktree)
    return { project, worktree: realpathSync.native(worktree) }
  }

  it('accepts a worktree the repository of the project registered, only for that project', () => {
    const { project, worktree } = repoWithWorktree()
    expect(registeredWorktree([project], worktree)).toBe(worktree)
    expect(registeredWorktree([join(base, 'project')], worktree)).toBeNull()
    expect(registeredWorktree([project], project)).toBeNull()
  })

  it('refuses a folder whose .git file merely points at the repository', () => {
    const { project, worktree } = repoWithWorktree()
    const forged = join(base, 'forged')
    mkdirSync(forged)
    writeFileSync(join(forged, '.git'), `gitdir: ${join(project, '.git')}
`)
    expect(registeredWorktree([project], forged)).toBeNull()
    // Copying a real worktree's pointer does not help: its admin folder points back at the real worktree only.
    writeFileSync(join(forged, '.git'), readFileSync(join(worktree, '.git'), 'utf8'))
    expect(registeredWorktree([project], forged)).toBeNull()
  })

  it('never touches a UNC or device path, whatever the project registered', () => {
    const { project } = repoWithWorktree()
    for (const path of ['//attacker/share', String.raw`\\attacker\share`, String.raw`\\?\C:\x`, String.raw`\\.\pipe\x`, 'relative/wt']) expect(registeredWorktree([project], path)).toBeNull()
  })

  it('refuses a missing folder or one without .git', () => {
    expect(registeredWorktree([root], join(base, 'nowhere'))).toBeNull()
    expect(registeredWorktree([root], outside)).toBeNull()
  })
})
