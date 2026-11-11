// Frozen acceptance test for 1.5.0 F7 (OXE program): the contract of approvals with impact: the request's impact and
// Always-allow facts, the database preview, the "What agents can do" channels, the notification push, MCP coverage (all
// of it the person's) and the C3 codes. Names agreed with FRONTEND (08/11). Written by the planner; the executor must
// not edit it. CCR: docs/roadmap-1.5/ccr-f7-approvals.md §Contract.
import { describe, expect, test, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { MESSAGE_CODES } from '../../../shared/messages'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const claims = (key: string) => Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(key) || capability.ipc?.includes(`${key.split('.')[0]}.*`))

describe('F7 · contract', () => {
  test('F7: the approvals channels gain preview and alwaysAllow; What agents can do is its own namespace', () => {
    expect(IPC_CHANNELS.approvals).toMatchObject({ preview: 'approvals:preview', alwaysAllow: 'approvals:always-allow', openRequest: 'approvals:open-request' })
    expect(IPC_CHANNELS.agentPermissions).toEqual({
      list: 'agent-permissions:list', revokeRule: 'agent-permissions:revoke-rule', setDatabaseAccess: 'agent-permissions:set-database-access',
      setHostAccess: 'agent-permissions:set-host-access', undo: 'agent-permissions:undo', changed: 'agent-permissions:changed'
    })
  })

  test('F7: the preload calls each channel with what the window passes', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const on = vi.fn()
    const api = createOxeApi({ invoke, on, removeListener: vi.fn() } as PreloadIpc) as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>
    await api.approvals.preview('r1')
    await api.approvals.alwaysAllow('r1')
    await api.agentPermissions.list({ workspaceId: 'ws1' })
    await api.agentPermissions.revokeRule('rule-1')
    await api.agentPermissions.setDatabaseAccess({ id: 'c-dev', access: 'read' })
    await api.agentPermissions.setHostAccess({ workspaceId: 'ws1', host: 'api.example.com', access: 'blocked' })
    await api.agentPermissions.undo('tok')
    api.agentPermissions.onChanged(() => undefined)
    api.approvals.onOpenRequest(() => undefined)
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.approvals.preview, 'r1'], [IPC_CHANNELS.approvals.alwaysAllow, 'r1'], [IPC_CHANNELS.agentPermissions.list, { workspaceId: 'ws1' }],
      [IPC_CHANNELS.agentPermissions.revokeRule, 'rule-1'], [IPC_CHANNELS.agentPermissions.setDatabaseAccess, { id: 'c-dev', access: 'read' }],
      [IPC_CHANNELS.agentPermissions.setHostAccess, { workspaceId: 'ws1', host: 'api.example.com', access: 'blocked' }], [IPC_CHANNELS.agentPermissions.undo, 'tok']
    ])
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.agentPermissions.changed, expect.any(Function))
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.approvals.openRequest, expect.any(Function))
  })

  test('F7: MCP coverage: Always allow, the preview and every permissions control are forbidden to agents', () => {
    for (const key of ['approvals.alwaysAllow', 'approvals.preview', 'agentPermissions.list', 'agentPermissions.revokeRule', 'agentPermissions.setDatabaseAccess', 'agentPermissions.setHostAccess', 'agentPermissions.undo']) {
      const found = claims(key)
      expect(found, key).toHaveLength(1)
      expect(found[0], key).toHaveProperty('forbidden')
    }
  })

  test('F7: the C3 codes', () => {
    for (const code of ['permissions.production.readOnly', 'permissions.policy.readOnly', 'permissions.access.invalid', 'notify.agentNeedsYou', 'notify.requestsNeedYou', 'notify.requestBody',
      'approvals.alwaysAllow.notOffered', 'approvals.alwaysAllow.invalidSettings', 'approvals.alwaysAllow.outsideProject']) {
      expect(MESSAGE_CODES as readonly string[], code).toContain(code)
    }
  })
})
