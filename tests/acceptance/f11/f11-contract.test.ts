// Frozen acceptance test for 1.5.0 F11 (OXE program): the contract, with FRONTEND's names (08/11). The usage count and
// the hosts proxy are the person's settings: preloaded for the window, forbidden to agents over MCP, never phone
// commands. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f11-release.md §Contract.
import { describe, expect, test, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { MESSAGE_CODES } from '../../../shared/messages'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { REMOTE_COMMANDS } from '../../../shared/remote/protocol'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const channels = IPC_CHANNELS as unknown as Record<string, Record<string, string>>
const claims = (key: string) => Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(key) || capability.ipc?.includes(`${key.split('.')[0]}.*`))

describe('F11 · contract', () => {
  test('A65/A68: the usage count and the hosts proxy channels, preloaded', async () => {
    expect(channels.featureUsage).toMatchObject({ state: expect.any(String), setEnabled: expect.any(String), export: expect.any(String), clear: expect.any(String), record: expect.any(String), changed: expect.any(String) })
    expect(channels.hostsProxy).toMatchObject({ state: expect.any(String), setEnabled: expect.any(String), clear: expect.any(String), retry: expect.any(String), changed: expect.any(String) })
    const invoke = vi.fn().mockResolvedValue(undefined)
    const api = createOxeApi({ invoke, on: vi.fn(), removeListener: vi.fn() } as PreloadIpc) as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>
    await api.featureUsage.state()
    await api.featureUsage.setEnabled({ enabled: false, clear: true })
    await api.featureUsage.record('commandBar')
    await api.featureUsage.export()
    await api.hostsProxy.setEnabled(true)
    await api.hostsProxy.retry()
    expect(invoke.mock.calls).toEqual([
      [channels.featureUsage.state], [channels.featureUsage.setEnabled, { enabled: false, clear: true }], [channels.featureUsage.record, 'commandBar'], [channels.featureUsage.export],
      [channels.hostsProxy.setEnabled, true], [channels.hostsProxy.retry]
    ])
  })

  test('A65/A68 (SECURITY): both are the person\'s settings: forbidden to agents over MCP, never phone commands', () => {
    for (const key of ['featureUsage.state', 'featureUsage.setEnabled', 'featureUsage.export', 'featureUsage.clear', 'featureUsage.record', 'hostsProxy.state', 'hostsProxy.setEnabled', 'hostsProxy.clear', 'hostsProxy.retry']) {
      const claimed = claims(key)
      expect(claimed, key).toHaveLength(1)
      expect(claimed[0], key).toHaveProperty('forbidden')
    }
    // The path is live: the phone has commands, none of them these.
    expect(REMOTE_COMMANDS.length).toBeGreaterThan(0)
    expect((REMOTE_COMMANDS as readonly string[]).some(command => /usage|proxy/i.test(command))).toBe(false)
  })

  test('A68: the proxy\'s failed start is a C3 code', () => {
    for (const code of ['hostsProxy.portInUse', 'hostsProxy.failed', 'hostsProxy.userProxy']) expect(MESSAGE_CODES as readonly string[], code).toContain(code)
  })
})
