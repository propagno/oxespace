import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { AgentProcessTransport } from '../electron/main/services/conversation/process-transport'

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const spawn = vi.fn(), execFile = vi.fn()
  return { ...actual, default: { ...actual, spawn, execFile }, spawn, execFile }
})

it.skipIf(process.platform !== 'win32')('starts a hidden native Codex process directly for headless requests without the npm child launcher', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'oxe-process-transport-')), target = resolve(folder)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-process-transport-')) throw Error('Invalid fixture cleanup path')
  try {
    const root = join(folder, 'node_modules', '@openai', 'codex')
    const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
    const executable = join(root, 'vendor', triple, 'bin', 'codex.exe')
    await mkdir(dirname(executable), { recursive: true }); await mkdir(join(root, 'bin'), { recursive: true })
    await writeFile(join(root, 'bin', 'codex.js'), ''); await writeFile(executable, '')
    const shim = join(folder, 'codex.cmd'); await writeFile(shim, '')
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null }) as ChildProcessWithoutNullStreams
    vi.mocked(spawn).mockReturnValue(child)
    const args = ['app-server', '--listen', 'stdio://']
    vi.stubEnv('OXESPACE_WORKSPACE_ID', 'parent-workspace')
    vi.stubEnv('OXESPACE_EXECUTION_TOKEN', 'parent-execution')
    vi.stubEnv('OPENAI_API_KEY', 'parent-api-key')
    const transport = new AgentProcessTransport(shim, args, folder, { OXESPACE_WORKSPACE_ID: 'thread-workspace', OXESPACE_MCP_PORT: '12345', OXESPACE_MCP_TOKEN: 'thread-bridge', OXESPACE_MEMORY_RUN_ID: 'thread-run', OPENAI_API_KEY: 'forbidden', OXESPACE_EXECUTION_ID: 'fresh-execution', OXESPACE_EXECUTION_TOKEN: 'fresh-main-lease', OXESPACE_EXECUTION_GENERATION: '2' })
    expect(spawn).toHaveBeenCalledWith(executable, args, expect.objectContaining({ cwd: folder, windowsHide: true, detached: false, stdio: 'pipe' }))
    expect(vi.mocked(spawn).mock.calls[0][2]).not.toHaveProperty('shell')
    expect(vi.mocked(spawn).mock.calls[0][2]?.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(vi.mocked(spawn).mock.calls[0][2]?.env).toMatchObject({ OXESPACE_WORKSPACE_ID: 'thread-workspace', OXESPACE_MCP_PORT: '12345', OXESPACE_MCP_TOKEN: 'thread-bridge', OXESPACE_MEMORY_RUN_ID: 'thread-run' })
    expect(vi.mocked(spawn).mock.calls[0][2]?.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(vi.mocked(spawn).mock.calls[0][2]?.env).toMatchObject({ OXESPACE_EXECUTION_ID: 'fresh-execution', OXESPACE_EXECUTION_TOKEN: 'fresh-main-lease', OXESPACE_EXECUTION_GENERATION: '2' })
    expect(vi.mocked(spawn).mock.calls[0][2]?.env?.OXESPACE_EXECUTION_TOKEN).not.toBe('parent-execution')
    await transport.close()
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
  } finally { vi.unstubAllEnvs(); await rm(target, { recursive: true, force: true }) }
})
