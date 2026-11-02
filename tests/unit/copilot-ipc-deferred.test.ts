import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Copilot credits service loads on the first request (main entry budget): the channel registers at boot, the first
// call loads it, and a service that cannot load refuses that call and is tried again on the next.

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) } } }))

const { IPC_CHANNELS } = await import('../../shared/types/ipc')
const { registerCopilotIpc } = await import('../../electron/main/ipc/copilot.ipc')

type Service = Awaited<ReturnType<NonNullable<Parameters<typeof registerCopilotIpc>[0]>>>

describe('copilot credits: loaded on the first request', () => {
  beforeEach(() => handlers.clear())

  it('registers without loading the service, and the first call loads it', async () => {
    const getCredits = vi.fn(async (force: boolean) => ({ ok: true, force }))
    const load = vi.fn(async () => ({ getCredits }) as unknown as Service)
    registerCopilotIpc(load)
    expect(handlers.has(IPC_CHANNELS.copilot.credits)).toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(await handlers.get(IPC_CHANNELS.copilot.credits)!({}, true)).toEqual({ ok: true, force: true })
    expect(getCredits).toHaveBeenCalledWith(true)
  })

  it('a service that cannot load refuses the call; the next call tries again', async () => {
    const getCredits = vi.fn(async () => ({ ok: true }))
    const load = vi.fn<() => Promise<Service>>().mockRejectedValueOnce(new Error('chunk missing')).mockResolvedValue({ getCredits } as unknown as Service)
    registerCopilotIpc(load)
    await expect(handlers.get(IPC_CHANNELS.copilot.credits)!({})).rejects.toThrow('chunk missing')
    expect(getCredits).not.toHaveBeenCalled()
    expect(await handlers.get(IPC_CHANNELS.copilot.credits)!({})).toEqual({ ok: true })
  })
})
