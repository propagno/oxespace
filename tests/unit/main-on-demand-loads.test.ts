// @vitest-environment node
/**
 * What moved off the main entry (tests/unit/main-entry-imports.test.ts) still runs where it is used: the hook
 * install paths import their script and write it, and each on-demand service is imported once and kept, so only
 * the first request of a launch pays for the import and a failed one is retried by the next.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { createFakeIpcMain } from '../helpers/fake-ipc-main'

const ipc = createFakeIpcMain()
vi.mock('electron', () => ({ ipcMain: ipc, BrowserWindow: { getAllWindows: () => [] }, safeStorage: {}, app: { getPath: () => tmpdir() } }))

const { IPC_CHANNELS } = await import('../../shared/types/ipc')
const { registerAgentHooksIpc } = await import('../../electron/main/ipc/agent-hooks.ipc')
const { registerVoiceIpc } = await import('../../electron/main/ipc/voice.ipc')
const { registerOxeIpc } = await import('../../electron/main/ipc/oxe.ipc')
const { AgentMemoryAdapters } = await import('../../electron/main/services/memory/agent-memory-adapter')

describe('hook install paths load their script on demand', () => {
  test('memory hook setup imports the hook source and writes it, as the static import did', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oxespace-on-demand-hook-'))
    try {
      const runtime = { directory } as ConstructorParameters<typeof AgentMemoryAdapters>[0]
      // No agent targets: setup writes the shared hook script and stops before the native installer.
      await new AgentMemoryAdapters(runtime, []).setup()
      const written = await readFile(join(directory, 'adapters', 'oxespace-memory-hook.cjs'), 'utf8')
      expect(written).toBe(readFileSync(resolve('resources/memory/agent-hook.cjs'), 'utf8'))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('the status hook installer loads on the first Settings request, once, and installs through it', async () => {
    const installer = { status: vi.fn(async (agent: string) => ({ agent, state: 'missing' })), install: vi.fn(async (agent: string) => ({ agent, state: 'installed' })), remove: vi.fn() }
    const load = vi.fn(async () => installer as never)
    registerAgentHooksIpc(tmpdir(), load)
    expect(load).not.toHaveBeenCalled()
    await expect(ipc.invoke(IPC_CHANNELS.agentHooks.status)).resolves.toHaveLength(2)
    await expect(ipc.invoke(IPC_CHANNELS.agentHooks.install, 'codex')).resolves.toEqual({ agent: 'codex', state: 'installed' })
    expect(load).toHaveBeenCalledTimes(1)
    // An invalid agent is refused before anything loads or runs.
    await expect(ipc.invoke(IPC_CHANNELS.agentHooks.remove, 'nope')).rejects.toThrow('agent must be')
    expect(installer.remove).not.toHaveBeenCalled()
    ;['status', 'install', 'remove'].forEach(name => ipc.removeHandler(IPC_CHANNELS.agentHooks[name as 'status']))
  })

  test('the status hook script the installer gets is the file on disk', async () => {
    const { default: source } = await import('../../resources/agent-hooks/oxespace-status-hook.cjs?raw')
    expect(source).toBe(readFileSync(resolve('resources/agent-hooks/oxespace-status-hook.cjs'), 'utf8'))
  })
})

describe('on-demand services are imported once and kept', () => {
  test('voice: the second request reuses the service; a failed load is retried', async () => {
    const service = { getModelStatus: vi.fn(() => ({ ready: true })), transcribe: vi.fn(), ensureModel: vi.fn() }
    const load = vi.fn().mockRejectedValueOnce(new Error('load failed')).mockResolvedValue(service)
    registerVoiceIpc(load)
    await expect(ipc.invoke(IPC_CHANNELS.voice.getModelStatus)).rejects.toThrow('load failed')
    await ipc.invoke(IPC_CHANNELS.voice.getModelStatus)
    await ipc.invoke(IPC_CHANNELS.voice.getModelStatus, 'small')
    expect(load).toHaveBeenCalledTimes(2)
    expect(service.getModelStatus).toHaveBeenLastCalledWith('small')
    // Input is still checked first: a bad size never reaches, or loads, the service.
    await expect(ipc.invoke(IPC_CHANNELS.voice.getModelStatus, 'huge')).rejects.toThrow()
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('OXE: one import for every channel, and quitting before any request disposes nothing', async () => {
    const service = { detect: vi.fn(async () => ({ installed: true })), stopDashboard: vi.fn(() => ({ ok: true })), disposeAll: vi.fn() }
    const load = vi.fn(async () => service as never)
    const handle = registerOxeIpc(load)
    handle.disposeAll()
    expect(load).not.toHaveBeenCalled()
    await ipc.invoke(IPC_CHANNELS.oxe.detect)
    await ipc.invoke(IPC_CHANNELS.oxe.detect, true)
    await ipc.invoke(IPC_CHANNELS.oxe.stopDashboard, '/repo')
    expect(load).toHaveBeenCalledTimes(1)
    expect(service.detect).toHaveBeenLastCalledWith(true)
    handle.disposeAll()
    expect(service.disposeAll).toHaveBeenCalledTimes(1)
  })

  test('an OxeQuery agent call imports nothing: the gateway is built once, with the OxeQuery service', () => {
    // The tools only recognise the gateway's refusals; the gateway itself is created by the service at OxeQuery
    // startup and handed to them through ctx.oxeQuery(), so no agent call waits on an import.
    const tools = readFileSync(resolve('electron/main/mcp-internal/oxequery-tools.ts'), 'utf8')
    expect(tools).not.toMatch(/\bimport\s*\(/)
    expect(tools).toContain("from '../services/oxequery/agent-tool-error'")
    const service = readFileSync(resolve('electron/main/services/oxequery/service.ts'), 'utf8')
    expect(service).toMatch(/^import \{ AgentGateway \} from '\.\/agent-gateway'/m)
    expect(service.match(/new AgentGateway\(/g)).toHaveLength(1)
  })
})
