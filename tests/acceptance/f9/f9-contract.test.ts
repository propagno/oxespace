// Frozen acceptance test for 1.5.0 F9 (OXE program): the contract. The Containers panel is one new OxePod operation on
// the existing oxePod:call channel (the actions, Connect and the shell are already there); its rows are the window's
// read model, so agents don't reach it. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f9-panels.md §Contract.
import { describe, expect, test, vi } from 'vitest'
import { createFakeIpcMain, type FakeIpcMain } from '../../helpers/fake-ipc-main'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const ipcMain: FakeIpcMain = createFakeIpcMain()
vi.mock('electron', () => ({ ipcMain, BrowserWindow: { getAllWindows: () => [], fromWebContents: () => ({}) } }))
const { OXEPOD_OPS, registerOxePodIpc } = await import('../../../electron/main/ipc/oxepod.ipc')

const calls: Array<[string, unknown]> = []
registerOxePodIpc(async () => ({ call: async (op: string, input: unknown) => { calls.push([op, input]); return { ok: true as const, value: { rows: [] } } } }), error => String(error))

describe('F9 · contract', () => {
  test('A34: containers.panel is an OxePod operation, carried by oxePod:call to the service', async () => {
    expect(OXEPOD_OPS).toContain('containers.panel')
    // The existing operations the panel's actions use are all still there.
    for (const op of ['containers.action', 'containers.remove', 'containers.compose', 'containers.logsStart', 'containers.shell', 'containers.suggestConnection']) expect(OXEPOD_OPS, op).toContain(op)
    const result = await ipcMain.invoke(IPC_CHANNELS.oxePod.call, 'containers.panel', { engine: 'docker' })
    expect(result).toMatchObject({ ok: true })
    expect(calls).toEqual([['containers.panel', { engine: 'docker' }]])
  })

  test('A34: Remove and taking a stack down still need the person\'s confirmation in main', async () => {
    const { OxePodService } = await import('../../../electron/main/services/oxepod/service')
    const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }))
    const service = new OxePodService({ host: { id: 'x', kind: 'local', exec, readTextFile: vi.fn(), writeTextFile: vi.fn() } as never, emit: () => undefined })
    expect(await service.call('containers.remove', { id: 'pg-dev' })).toMatchObject({ ok: false, error: { code: 'confirm' } })
    expect(await service.call('containers.compose', { id: 'pg-dev', action: 'down' })).toMatchObject({ ok: false, error: { code: 'confirm' } })
    // The path is live: confirmed, the same remove reaches the engine.
    await service.call('containers.remove', { id: 'pg-dev', confirmed: true })
    expect(exec.mock.calls.some(call => (call as unknown as [string, string[]])[1].includes('rm'))).toBe(true)
  })
})
