// Frozen acceptance test for 1.5.0 F5 (OXE program): the contract of the agent browser, emulation and the Android
// mirror, agreed with FRONTEND (08/11). The agent browser rides on the existing browserPreview API and its
// browser-preview:event stream; Android is window.oxe.android. MCP coverage keeps the person's controls from agents.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f5-see-agent.md §Contract.
import { describe, expect, test, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { MESSAGE_CODES } from '../../../shared/messages'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const claims = (key: string) => Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(key) || capability.ipc?.includes(`${key.split('.')[0]}.*`))

describe('F5 · contract', () => {
  test('F5: the agent browser adds revokeGrant and setDevice to browserPreview, and keeps its event stream', () => {
    expect(IPC_CHANNELS.browserPreview).toMatchObject({ revokeGrant: 'browser-preview:revoke-grant', setDevice: 'browser-preview:set-device', onEvent: 'browser-preview:event' })
  })

  test('F5: the Android mirror channels', () => {
    expect(IPC_CHANNELS.android).toEqual({
      status: 'android:status', changed: 'android:changed', connect: 'android:connect', disconnect: 'android:disconnect', frame: 'android:frame',
      tap: 'android:tap', swipe: 'android:swipe', key: 'android:key', rotate: 'android:rotate', screenshot: 'android:screenshot',
      setAgentsCanSee: 'android:set-agents-can-see', startEmulator: 'android:start-emulator'
    })
  })

  test('F5: the preload calls each channel with what the window passes', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const on = vi.fn()
    const api = createOxeApi({ invoke, on, removeListener: vi.fn() } as PreloadIpc) as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>
    await api.browserPreview.revokeGrant({ ownerKey: 'code:ws1', tabId: 't1' })
    await api.browserPreview.setDevice({ ownerKey: 'code:ws1', tabId: 't1', deviceId: 'pixel-8', rotated: false })
    await api.android.status()
    await api.android.tap({ serial: 'emulator-5554', x: 1, y: 2 })
    await api.android.setAgentsCanSee({ serial: 'emulator-5554', value: true })
    api.android.onChanged(() => undefined)
    api.android.onFrame(() => undefined)
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.browserPreview.revokeGrant, { ownerKey: 'code:ws1', tabId: 't1' }],
      [IPC_CHANNELS.browserPreview.setDevice, { ownerKey: 'code:ws1', tabId: 't1', deviceId: 'pixel-8', rotated: false }],
      [IPC_CHANNELS.android.status], [IPC_CHANNELS.android.tap, { serial: 'emulator-5554', x: 1, y: 2 }],
      [IPC_CHANNELS.android.setAgentsCanSee, { serial: 'emulator-5554', value: true }]
    ])
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.android.changed, expect.any(Function))
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.android.frame, expect.any(Function))
  })

  test('F5: MCP coverage: the person\'s Android controls and the grant revoke are forbidden to agents; the device choice is the person\'s preview control', () => {
    for (const key of ['android.tap', 'android.swipe', 'android.key', 'android.setAgentsCanSee', 'android.connect', 'browserPreview.revokeGrant']) {
      const found = claims(key)
      expect(found, key).toHaveLength(1)
      expect(found[0], key).toHaveProperty('forbidden')
    }
    const device = claims('browserPreview.setDevice')
    expect(device).toHaveLength(1)
    expect(Object.keys((device[0] as { tools?: Record<string, string> }).tools ?? {})).not.toContain('oxespace_set_device')
  })

  test('F5: the C3 codes for a capture that cannot happen now', () => {
    for (const code of ['preview.capture.devtools', 'preview.capture.busy']) expect(MESSAGE_CODES as readonly string[]).toContain(code)
  })
})
