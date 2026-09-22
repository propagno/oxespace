import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import type { IPty, IPtyForkOptions } from 'node-pty'
import { ThreadNativeCli } from '../electron/main/services/conversation/thread-cli'
import { interactiveConversationCommand } from '../electron/main/services/conversation/process-transport'
import type { ConversationThread } from '../shared/types/thread'

vi.mock('node-pty', () => ({ spawn: vi.fn() }))
const id = '11111111-1111-4111-8111-111111111111'
function fixture(provider: 'claude' | 'codex') {
  let data: (text: string) => void = () => {}, exit: (event: { exitCode: number }) => void = () => {}
  const pty = { pid: 999, write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    onData: vi.fn(listener => { data = listener; return { dispose: vi.fn() } }),
    onExit: vi.fn(listener => { exit = listener; return { dispose: vi.fn() } }) } as unknown as IPty
  const spawn = vi.fn((_file: string, _args: string[], _options: IPtyForkOptions) => pty), emitData = vi.fn(), emitExit = vi.fn(), ended = vi.fn(async () => {})
  const resolve = vi.fn((command: string, args: string[], env: NodeJS.ProcessEnv = {}) => ({ executable: command, args, env }))
  const cli = new ThreadNativeCli(() => 'native.exe', { spawn, resolve, env: { PATH: '/safe', OPENAI_API_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', OXESPACE_MCP_TOKEN: 'secret', CODEX_HOME: '/native/home' }, data: emitData, exit: emitExit })
  const thread = { id: 'thread', provider, rootPath: process.cwd(), nativeSessionId: id } as ConversationThread
  return { cli, thread, spawn, resolve, pty, emitData, emitExit, ended, data: (text: string) => data(text), exit: () => exit({ exitCode: 0 }) }
}

describe('native Thread CLI transport', () => {
  it('resolves an npm Windows shim to the native Rust binary without launching Electron under ConPTY', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'oxe-cli-resolver-')), target = resolvePath(folder)
    if (dirname(target) !== resolvePath(tmpdir()) || !basename(target).startsWith('oxe-cli-resolver-')) throw Error('Invalid cleanup target')
    try {
      const root = join(folder, 'node_modules', '@openai', 'codex')
      const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
      const binary = join(root, 'vendor', triple, 'bin', 'codex.exe')
      await mkdir(dirname(binary), { recursive: true }); await mkdir(join(root, 'bin'), { recursive: true })
      await writeFile(join(root, 'bin', 'codex.js'), ''); await writeFile(binary, '')
      const shim = join(folder, 'codex.cmd'); await writeFile(shim, '')
      const args = ['resume', id, '--no-alt-screen']
      const result = interactiveConversationCommand(shim, args, { ELECTRON_RUN_AS_NODE: '1', CODEX_HOME: '/native' }, 'win32')
      expect(result).toEqual({ executable: binary, args, env: { CODEX_HOME: '/native' } })
      await rm(binary)
      expect(() => interactiveConversationCommand(shim, args, {}, 'win32')).toThrow('native executable')
    } finally { await rm(target, { recursive: true, force: true }) }
  })
  it('resumes the exact provider session without a shell or API/environment credentials, and never auto-submits through login/trust', async () => {
    for (const provider of ['claude', 'codex'] as const) {
      const f = fixture(provider), session = await f.cli.open(f.thread, '/permissions', f.ended)
      const launch = f.spawn.mock.calls[0]
      expect(launch[1]).toEqual(expect.arrayContaining(['--resume', id].filter(value => provider === 'claude' || value !== '--resume')))
      expect(launch[2]).toMatchObject({ cwd: process.cwd() })
      expect(launch[2].env).not.toHaveProperty('OPENAI_API_KEY')
      expect(launch[2].env).not.toHaveProperty('OXESPACE_MCP_TOKEN')
      expect(launch[2].env).toHaveProperty('CODEX_HOME', '/native/home')
      expect(f.pty.write).not.toHaveBeenCalled()
      f.data('Do you trust this project?\r\n')
      expect(f.pty.write).not.toHaveBeenCalled()
      await session.insertCommand()
      expect(f.pty.write).toHaveBeenCalledWith('\x1b[200~/permissions\x1b[201~')
      expect(session.state().pendingCommand).toBeUndefined()
      await session.insertCommand(); expect(f.pty.write).toHaveBeenCalledOnce()
      f.exit(); await session.close(); expect(f.ended).toHaveBeenCalledWith(id, false)
    }
  })
  it('retains ordered output across Thread view switches and tracks Codex explicit resume IDs across chunks', async () => {
    const f = fixture('codex'), session = await f.cli.open(f.thread, undefined, f.ended)
    f.data('Native header\r\n')
    const attached = session.attach()
    expect(attached.replay).toBe('Native header\r\n')
    expect(f.emitData).not.toHaveBeenCalled()
    session.detach(); f.data('Native content\r\n')
    const restored = session.attach()
    expect(restored.replay).toContain('Native content')
    session.resize(140, 45)
    const next = '22222222-2222-4222-8222-222222222222'
    f.data(`Example command: codex resume ${next}`)
    expect(session.state().nativeSessionId).toBe(id)
    f.data('To continue this session, run codex res'); f.data(`ume ${next}`)
    expect(session.state().nativeSessionId).toBe(next)
    f.exit(); await session.close()
    expect(f.ended).toHaveBeenCalledWith(next, false)
    expect(f.emitExit).toHaveBeenCalledOnce()
  })
  it('rejects control sequences, invalid session IDs and missing directories before spawning', async () => {
    const f = fixture('claude')
    for (const command of ['/quit\x1b[31m', '/model\0x']) await expect(f.cli.open(f.thread, command, f.ended)).rejects.toThrow('input')
    await expect(f.cli.open({ ...f.thread, nativeSessionId: '../other' }, undefined, f.ended)).rejects.toThrow('identifier')
    await expect(f.cli.open({ ...f.thread, rootPath: '/definitely-missing-oxe-native-thread' }, undefined, f.ended)).rejects.toThrow('unavailable')
    expect(f.spawn).not.toHaveBeenCalled()
  })
})
