import { describe, expect, it, vi } from 'vitest'
import { TOOL_REGISTRY } from '../electron/main/mcp-internal/tool-registry'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } from '../shared/mcp-coverage'
import { IPC_CHANNELS } from '../shared/types/ipc'
import { REMOTE_DEFAULT_DESKTOP_NAME, REMOTE_MAX_DESKTOP_NAME_LENGTH, REMOTE_MIN_PORT } from '../shared/types/remote'

vi.mock('../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

const ACTIONS = ['setEnabled', 'startPairing', 'cancelPairing', 'answerPairing', 'revoke', 'rename', 'setDesktopName', 'setPhoneWrite'] as const

describe('Settings › Devices contract (remote.*)', () => {
  it('uses stable channel names', () => {
    expect(IPC_CHANNELS.remote).toEqual({
      status: 'remote:status', devices: 'remote:devices', changed: 'remote:changed', setEnabled: 'remote:set-enabled', startPairing: 'remote:start-pairing',
      cancelPairing: 'remote:cancel-pairing', answerPairing: 'remote:answer-pairing', revoke: 'remote:revoke', rename: 'remote:rename',
      setDesktopName: 'remote:set-desktop-name', setPhoneWrite: 'remote:set-phone-write'
    })
  })

  it('keeps every action with the person: forbidden to MCP, and no tool reaches the gateway', () => {
    expect(FORBIDDEN_CAPABILITIES).toContain('remote.gateway_admin')
    const admin = MCP_COVERAGE['remote.gateway_admin']
    expect('forbidden' in admin && !('tools' in admin)).toBe(true)
    expect(admin.ipc).toEqual(ACTIONS.map(action => `remote.${action}`))
    const read = MCP_COVERAGE['remote.devices_read']
    expect('excluded' in read && !('tools' in read)).toBe(true)
    expect(TOOL_REGISTRY.map(entry => entry.descriptor.name).filter(name => /remote|device|pair|gateway/i.test(name))).toEqual([])
  })

  it('refuses ports the system reserves, and shows phones a chosen name, never the host name', () => {
    expect(REMOTE_MIN_PORT).toBe(1024)
    expect(REMOTE_DEFAULT_DESKTOP_NAME).toBe('OXESpace')
    expect(REMOTE_MAX_DESKTOP_NAME_LENGTH).toBe(32)
  })

  it('exposes each channel through the preload, and nothing else', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    const remote = createOxeApi(ipc).remote!
    await remote.status()
    await remote.devices()
    await remote.setEnabled({ enabled: true, port: 47_321 })
    await remote.startPairing()
    await remote.cancelPairing()
    await remote.answerPairing({ promptId: 'p', accept: true })
    await remote.revoke({ deviceId: 'd' })
    await remote.rename({ deviceId: 'd', name: 'Phone' })
    await remote.setDesktopName({ name: 'Estudos' })
    await remote.setPhoneWrite({ paneId: 'p1', allowed: true })
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      [IPC_CHANNELS.remote.status], [IPC_CHANNELS.remote.devices], [IPC_CHANNELS.remote.setEnabled, { enabled: true, port: 47_321 }],
      [IPC_CHANNELS.remote.startPairing], [IPC_CHANNELS.remote.cancelPairing], [IPC_CHANNELS.remote.answerPairing, { promptId: 'p', accept: true }],
      [IPC_CHANNELS.remote.revoke, { deviceId: 'd' }], [IPC_CHANNELS.remote.rename, { deviceId: 'd', name: 'Phone' }],
      [IPC_CHANNELS.remote.setDesktopName, { name: 'Estudos' }],
      [IPC_CHANNELS.remote.setPhoneWrite, { paneId: 'p1', allowed: true }]
    ])
    remote.onChanged(vi.fn())
    expect(ipc.on).toHaveBeenCalledWith(IPC_CHANNELS.remote.changed, expect.any(Function))
    expect(Object.keys(remote).sort()).toEqual(['answerPairing', 'cancelPairing', 'devices', 'onChanged', 'rename', 'revoke', 'setDesktopName', 'setEnabled', 'setPhoneWrite', 'startPairing', 'status'])
  })
})
