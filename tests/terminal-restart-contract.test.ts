// B17 · terminal.restart with `resume: false` (CCR): strict validation, the preload, and the E2E mock's record.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } }))

import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { registerTerminalIpc, type TerminalIpcController } from '../electron/main/ipc/terminal.ipc'
import { parseTerminalRestartInput } from '../electron/main/ipc/validation'
import { E2E_TERMINAL_RESTARTS_GLOBAL, registerTerminalRestartMock } from '../electron/main/e2e/terminal-restart-mock'
import { IPC_CHANNELS } from '../shared/types/ipc'

beforeEach(() => handlers.clear())

describe('terminal:restart input', () => {
  it('accepts only an absent resume or the literal false', () => {
    expect(parseTerminalRestartInput({ paneId: 'p1' })).toEqual({ paneId: 'p1' })
    expect(parseTerminalRestartInput({ paneId: 'p1', resume: false })).toEqual({ paneId: 'p1', resume: false })
    for (const resume of [true, 'false', 0, null, {}, [false]]) expect(() => parseTerminalRestartInput({ paneId: 'p1', resume }), String(resume)).toThrow('resume must be false')
    expect(() => parseTerminalRestartInput({ resume: false })).toThrow()
  })

  it('the handler refuses a bad value before reaching the terminals', async () => {
    const restart = vi.fn()
    registerTerminalIpc({ restart } as unknown as TerminalIpcController)
    const handler = handlers.get(IPC_CHANNELS.terminal.restart)!
    expect(() => handler({}, { paneId: 'p1', resume: 'no' })).toThrow('resume must be false')
    expect(restart).not.toHaveBeenCalled()
    await handler({}, { paneId: 'p1', resume: false })
    await handler({}, { paneId: 'p1', extra: 1 })
    expect(restart.mock.calls).toEqual([[{ paneId: 'p1', resume: false }], [{ paneId: 'p1' }]])
  })

  it('the E2E mock records each valid restart with its resume flag, and refuses a bad one', async () => {
    const scope: Record<string, unknown> = {}
    registerTerminalRestartMock(scope)
    const handler = handlers.get(IPC_CHANNELS.terminal.restart)!
    await handler({}, { paneId: 'p1' })
    await handler({}, { paneId: 'p2', resume: false })
    expect(() => handler({}, { paneId: 'p3', resume: true })).toThrow('resume must be false')
    expect(scope[E2E_TERMINAL_RESTARTS_GLOBAL]).toEqual([{ paneId: 'p1' }, { paneId: 'p2', resume: false }])
    expect(E2E_TERMINAL_RESTARTS_GLOBAL).toBe('__oxeTerminalRestarts')
  })

  it('the preload passes the field through unchanged', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    await createOxeApi(ipc).terminal.restart({ paneId: 'p1', resume: false })
    expect(vi.mocked(ipc.invoke)).toHaveBeenCalledWith(IPC_CHANNELS.terminal.restart, { paneId: 'p1', resume: false })
  })
})
