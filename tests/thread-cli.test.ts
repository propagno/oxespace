import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { conversationCommand, interactiveConversationCommand } from '../electron/main/services/conversation/process-transport'
import { MainRefusal } from '../electron/main/services/main-refusal'

const id = '11111111-1111-4111-8111-111111111111'
const args = ['resume', id, '--no-alt-screen']
const folders: string[] = []

async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'oxe-cli-resolver-')), target = resolvePath(folder)
  if (dirname(target) !== resolvePath(tmpdir()) || !basename(target).startsWith('oxe-cli-resolver-')) throw Error('Invalid cleanup target')
  folders.push(target)
  return folder
}

async function touch(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '')
  return path
}

/** An npm global install of Codex on Windows: `codex.cmd` beside `node_modules/@openai/codex/bin/codex.js`. */
async function npmCodex(folder: string): Promise<{ shim: string; root: string }> {
  const root = join(folder, 'node_modules', '@openai', 'codex')
  await touch(join(root, 'bin', 'codex.js'))
  return { shim: await touch(join(folder, 'codex.cmd')), root }
}

function refusalCode(run: () => unknown): string | undefined {
  try { run() } catch (error) { return error instanceof MainRefusal ? error.code : `plain: ${(error as Error).message}` }
  return undefined
}

afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })

describe('native conversation command resolution (B13: never the app binary as Node)', () => {
  it('resolves an npm Windows shim to the vendored native binary and drops ELECTRON_RUN_AS_NODE', async () => {
    const folder = await tempFolder()
    const { shim, root } = await npmCodex(folder)
    const binary = await touch(join(root, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))
    for (const resolve of [conversationCommand, interactiveConversationCommand]) {
      expect(resolve(shim, args, { ELECTRON_RUN_AS_NODE: '1', CODEX_HOME: '/native' }, 'win32', 'x64')).toEqual({ executable: binary, args, env: { CODEX_HOME: '/native' } })
    }
  })

  it('finds the older vendor/<target>/codex/codex.exe layout and the arm64 target', async () => {
    const folder = await tempFolder()
    const { shim, root } = await npmCodex(folder)
    const arm = await touch(join(root, 'vendor', 'aarch64-pc-windows-msvc', 'codex', 'codex.exe'))
    expect(conversationCommand(shim, args, {}, 'win32', 'arm64').executable).toBe(arm)
    expect(refusalCode(() => conversationCommand(shim, args, {}, 'win32', 'x64'))).toBe('thread.agent.nativeMissing')
  })

  it('prefers the platform package Codex installs as an optional dependency', async () => {
    const folder = await tempFolder()
    const { shim, root } = await npmCodex(folder)
    await touch(join(root, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))
    const platformRoot = join(root, 'node_modules', '@openai', 'codex-win32-x64')
    await mkdir(platformRoot, { recursive: true })
    await writeFile(join(platformRoot, 'package.json'), JSON.stringify({ name: '@openai/codex-win32-x64', version: '0.0.0' }))
    const preferred = await touch(join(platformRoot, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))
    expect(conversationCommand(shim, args, {}, 'win32', 'x64').executable).toBe(preferred)
  })

  it('never takes a codex.exe planted in a parent node_modules (as C:\\node_modules by another user) (T7, M-2)', async () => {
    const outer = await tempFolder()
    const planted = await touch(join(outer, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))
    await writeFile(join(outer, 'node_modules', '@openai', 'codex-win32-x64', 'package.json'), JSON.stringify({ name: '@openai/codex-win32-x64', version: '9.9.9' }))
    const install = join(outer, 'npm-global')
    const { shim, root } = await npmCodex(install)
    // Vendor-only layout (older Codex, or installed with --no-optional): the planted package is the only platform package.
    const vendored = await touch(join(root, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))
    expect(conversationCommand(shim, args, {}, 'win32', 'x64').executable).toBe(vendored)
    expect(conversationCommand(shim, args, {}, 'win32', 'x64').executable).not.toBe(planted)
    // With nothing of its own, the shim is refused rather than handed the planted binary.
    await rm(vendored)
    expect(refusalCode(() => conversationCommand(shim, args, {}, 'win32', 'x64'))).toBe('thread.agent.nativeMissing')
  })

  it('a candidate that links out of the install folder is refused (M-2)', async () => {
    const outside = await tempFolder()
    await touch(join(outside, 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))
    const folder = await tempFolder()
    const { shim, root } = await npmCodex(folder)
    const link = join(root, 'vendor')
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    // The link goes first, on its own, so the folder cleanup never walks through it.
    try { expect(refusalCode(() => conversationCommand(shim, args, {}, 'win32', 'x64'))).toBe('thread.agent.nativeMissing') } finally { await unlink(link) }
  })

  it('drops ELECTRON_RUN_AS_NODE under any casing (L-2)', async () => {
    const folder = await tempFolder()
    const exe = await touch(join(folder, 'claude.exe'))
    const result = conversationCommand(exe, args, { ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1', Electron_Run_As_Node: '1', KEEP: 'yes' }, 'win32', 'x64')
    expect(result.env).toEqual({ KEEP: 'yes' })
  })

  it('refuses with C3 codes: a shim without its native binary, and any other script', async () => {
    const folder = await tempFolder()
    const { shim } = await npmCodex(folder)
    expect(refusalCode(() => conversationCommand(shim, args, {}, 'win32', 'x64'))).toBe('thread.agent.nativeMissing')
    const other = await touch(join(folder, 'agent.cmd'))
    expect(refusalCode(() => conversationCommand(other, args, {}, 'win32', 'x64'))).toBe('thread.agent.scriptUnsupported')
    // A codex.cmd that is not an npm install (no bin/codex.js beside it) is an arbitrary script too.
    const lone = await touch(join(await tempFolder(), 'codex.cmd'))
    expect(refusalCode(() => conversationCommand(lone, args, {}, 'win32', 'x64'))).toBe('thread.agent.scriptUnsupported')
  })

  it('finds a bare name on PATH, .exe before .cmd', async () => {
    const folder = await tempFolder()
    const { root } = await npmCodex(folder)
    await touch(join(root, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))
    const exe = await touch(join(folder, 'codex.exe'))
    expect(conversationCommand('codex', args, { PATH: folder }, 'win32', 'x64').executable).toBe(exe)
  })

  it('invariant: no input, on any platform, yields the app binary or ELECTRON_RUN_AS_NODE', async () => {
    const folder = await tempFolder()
    const { shim, root } = await npmCodex(folder)
    await touch(join(root, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))
    const native = await touch(join(folder, 'claude.exe'))
    const unix = await touch(join(folder, 'codex'))
    const app = await touch(join(folder, 'OXESpace.exe'))
    const env = { ELECTRON_RUN_AS_NODE: '1', PATH: folder }
    const outcomes: unknown[] = []
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      for (const command of [shim, native, unix, 'codex', 'claude', `"${shim}"`, app, app.toUpperCase()]) {
        try {
          const result = conversationCommand(command, args, env, platform, 'x64', app)
          outcomes.push(result)
          expect(result.executable.toLowerCase()).not.toBe(app.toLowerCase())
          expect(result.executable).not.toBe(process.execPath)
          expect(result.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
        } catch (error) {
          outcomes.push(error)
        }
      }
    }
    // The app binary itself is refused, never resolved, on Windows (case-insensitively) and elsewhere.
    expect(refusalCode(() => conversationCommand(app, args, env, 'win32', 'x64', app))).toBe('thread.agent.scriptUnsupported')
    // Another spelling of the same file only exists on a case-insensitive file system.
    if (process.platform === 'win32') expect(refusalCode(() => conversationCommand(app.toUpperCase(), args, env, 'win32', 'x64', app))).toBe('thread.agent.scriptUnsupported')
    expect(refusalCode(() => conversationCommand(app, args, env, 'linux', 'x64', app))).toBe('thread.agent.scriptUnsupported')
    expect(outcomes.some(outcome => !(outcome instanceof Error))).toBe(true)
  })
})
