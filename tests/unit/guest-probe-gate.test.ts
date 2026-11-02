/**
 * B12 · The E2E-only guest probe (`window.__oxeGuestProbe`, e2e/ipc-sender-guard.spec.ts) exists only when the main
 * process passes GUEST_PROBE_ARGUMENT to the preview guest, and the main process passes it only off a packaged build
 * with OXESPACE_E2E_GUEST_PROBE=1. A shipped app never has it; the main window never has it.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ exposed: vi.fn(), invoke: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({
  ipcRenderer: { on: vi.fn(), send: hooks.send, invoke: hooks.invoke, sendToHost: vi.fn() },
  contextBridge: { exposeInMainWorld: hooks.exposed },
  app: { isPackaged: true },
  session: { fromPartition: vi.fn() }
}))

import { GUEST_PROBE_ARGUMENT } from '../../shared/types/design-mode'
import { guestProbeWebPreferences } from '../../electron/main/services/browser-preview-security'

async function loadGuestPreload(argv: string[]): Promise<void> {
  vi.resetModules()
  const original = process.argv
  process.argv = argv
  try { await import('../../electron/preload/design-guest') } finally { process.argv = original }
}

afterEach(() => { vi.clearAllMocks() })

describe('the guest probe gate in the main process', () => {
  it('never arms a packaged build, whatever the environment says', () => {
    expect(guestProbeWebPreferences({ OXESPACE_E2E_GUEST_PROBE: '1' }, true)).toEqual({})
    expect(guestProbeWebPreferences({ OXESPACE_E2E_GUEST_PROBE: '1', OXESPACE_E2E_MOCK_NATIVE: '1' }, true)).toEqual({})
  })

  it('is off unless the E2E run asks for it', () => {
    expect(guestProbeWebPreferences({}, false)).toEqual({})
    expect(guestProbeWebPreferences({ OXESPACE_E2E_MOCK_NATIVE: '1' }, false)).toEqual({})
    expect(guestProbeWebPreferences({ OXESPACE_E2E_GUEST_PROBE: 'yes' }, false)).toEqual({})
  })

  it('arms the guest with the argument and nothing else', () => {
    expect(guestProbeWebPreferences({ OXESPACE_E2E_GUEST_PROBE: '1' }, false)).toEqual({ additionalArguments: [GUEST_PROBE_ARGUMENT] })
  })

  it('is never given to the main window', () => {
    const index = readFileSync(join(resolve(__dirname, '../..'), 'electron', 'main', 'index.ts'), 'utf8')
    expect(index).not.toContain('GUEST_PROBE_ARGUMENT')
    expect(index).not.toContain(GUEST_PROBE_ARGUMENT)
    expect(index).not.toContain('guestProbeWebPreferences')
  })
})

describe('the guest probe gate in the preview preload', () => {
  it('exposes nothing without the argument', async () => {
    await loadGuestPreload(['electron', '--oxe-locale=en-US'])
    expect(hooks.exposed).not.toHaveBeenCalled()
  })

  it('exposes the probe with the argument, and it reports a refusal as data', async () => {
    await loadGuestPreload(['electron', '--oxe-locale=en-US', GUEST_PROBE_ARGUMENT])
    expect(hooks.exposed).toHaveBeenCalledTimes(1)
    const [name, probe] = hooks.exposed.mock.calls[0] as [string, { invoke(channel: string, payload?: unknown): Promise<unknown>; send(channel: string, payload?: unknown): void }]
    expect(name).toBe('__oxeGuestProbe')
    hooks.invoke.mockRejectedValueOnce(Object.assign(new Error('ipc.sender.refused'), { code: 'ipc.sender.refused' }))
    await expect(probe.invoke('terminal:write', { paneId: 'p', data: 'x' })).resolves.toEqual({ ok: false, message: 'ipc.sender.refused' })
    hooks.invoke.mockResolvedValueOnce(undefined)
    await expect(probe.invoke('demo:ok')).resolves.toEqual({ ok: true, value: null })
    probe.send('oxe:design-grab', { selector: '#a' })
    expect(hooks.send).toHaveBeenCalledWith('oxe:design-grab', { selector: '#a' })
  })

  it('is the only thing the preload exposes to the page', () => {
    const preload = readFileSync(join(resolve(__dirname, '../..'), 'electron', 'preload', 'design-guest.ts'), 'utf8')
    expect(preload.match(/exposeInMainWorld\(/g)).toHaveLength(1)
    expect(preload).toMatch(/process\.argv\.includes\(GUEST_PROBE_ARGUMENT\)/)
  })
})
