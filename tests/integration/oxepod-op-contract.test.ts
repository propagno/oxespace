/**
 * The contract of OxePod's channel, `oxePod:call`: which operations it carries, that each one reaches a service that
 * knows it, and that anything else (an unknown name, an OxeQuery operation, a request from another frame) is refused
 * before the service is even loaded.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { createFakeIpcMain, type FakeIpcMain } from '../helpers/fake-ipc-main'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { ExecutionHost } from '../../electron/main/runtime/execution-host'

const ipcMain: FakeIpcMain = createFakeIpcMain()
const window = { trusted: true }
vi.mock('electron', () => ({ ipcMain, BrowserWindow: { getAllWindows: () => [], fromWebContents: () => (window.trusted ? {} : null) } }))

const { OXEPOD_OPS, registerOxePodIpc } = await import('../../electron/main/ipc/oxepod.ipc')
const { OXEQUERY_OPS } = await import('../../electron/main/ipc/oxequery.ipc')
const { OxePodService } = await import('../../electron/main/services/oxepod/service')

/** The operation names an `XOps` interface of a shared types file declares. */
function declaredOps(file: string, name: string): string[] {
  const text = readFileSync(file, 'utf8')
  const body = text.slice(text.indexOf(`export interface ${name} {`), text.indexOf('\n}\n', text.indexOf(`export interface ${name} {`)))
  return [...body.matchAll(/^ {2}'([a-zA-Z.]+)':/gm)].map(match => match[1])
}

const EXPECTED = [
  'containers.engines', 'containers.candidates', 'containers.useCandidate', 'containers.list', 'containers.inspect', 'containers.stats', 'containers.action', 'containers.remove',
  'containers.compose', 'containers.exec', 'containers.logsStart', 'containers.logsStop', 'containers.shell', 'containers.suggestConnection',
  'resources.images', 'resources.volumes', 'resources.networks', 'resources.usage', 'resources.remove', 'resources.prune'
]

const load = vi.fn(async () => ({ call: vi.fn(async (op: string, input: unknown) => ({ ok: true as const, value: { op, input } })) }))
registerOxePodIpc(load, error => `reason: ${error instanceof Error ? error.message : String(error)}`)

describe('OxePod op contract', () => {
  test('carries exactly the container and resource operations, on its own channel', () => {
    expect(IPC_CHANNELS.oxePod).toEqual({ call: 'oxePod:call', onEvent: 'oxePod:event' })
    expect([...OXEPOD_OPS].sort()).toEqual([...EXPECTED].sort())
    expect(new Set(OXEPOD_OPS).size).toBe(OXEPOD_OPS.length)
    expect([...declaredOps('shared/types/oxepod.ts', 'OxePodOps')].sort()).toEqual([...OXEPOD_OPS].sort())
    expect(OXEPOD_OPS.filter(op => !/^(containers|resources)\./.test(op))).toEqual([])
  })

  test('shares no operation with OxeQuery', () => {
    expect(OXEPOD_OPS.filter(op => (OXEQUERY_OPS as readonly string[]).includes(op))).toEqual([])
  })

  test('every listed operation is one the service handles', async () => {
    const host: ExecutionHost = { id: 'x', kind: 'local', exec: async () => ({ code: -1, stdout: '', stderr: 'spawn ENOENT', timedOut: false }), readTextFile: vi.fn(), writeTextFile: vi.fn() }
    const service = new OxePodService({ host, emit: () => undefined })
    for (const op of OXEPOD_OPS) {
      const response = await service.call(op, {})
      expect(response.ok ? '' : response.error.message, op).not.toBe('Unknown OxePod operation.')
    }
  })

  test('forwards a listed operation and its input to the service, loaded on first use', async () => {
    expect(load).not.toHaveBeenCalled()
    await expect(ipcMain.invoke('oxePod:call', { op: 'containers.list', input: { engine: 'docker' } })).resolves.toEqual({ ok: true, value: { op: 'containers.list', input: { engine: 'docker' } } })
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('refuses unknown operations, OxeQuery operations and malformed requests before loading anything', async () => {
    load.mockClear()
    for (const request of [{ op: 'nope' }, { op: 'connections.list' }, { op: 'sql.run' }, { op: 'connections.fromContainer' }, { op: 'connections.createInContainer' }, { op: 'containers.createDatabase' },
      { op: 42 }, {}, null, 'containers.list', { op: 'containers.list\0' }, { op: '__proto__' }, { op: 'constructor' }]) {
      await expect(ipcMain.invoke('oxePod:call', request), JSON.stringify(request)).rejects.toThrow('Unknown OxePod operation')
    }
    expect(load).not.toHaveBeenCalled()
  })

  test('answers only the application main frame', async () => {
    window.trusted = false
    try {
      await expect(ipcMain.invoke('oxePod:call', { op: 'containers.list', input: {} })).rejects.toThrow('OxePod requires the application main frame')
    } finally { window.trusted = true }
  })

  test('says why OxePod did not start instead of rejecting the call', async () => {
    load.mockRejectedValueOnce(new Error('engine module missing'))
    await expect(ipcMain.invoke('oxePod:call', { op: 'containers.engines', input: {} })).resolves.toEqual({ ok: false, error: {
      code: 'failed', message: 'OxePod did not start: reason: engine module missing',
      messageCode: { code: 'oxepod.startFailed', params: { reason: 'reason: engine module missing' } }
    } })
  })
})
