import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { IntegrationGroup } from '../../shared/types/integration'
import { HandoffInbox } from '../../src/components/Integration/HandoffInbox'
import { useIntegrationStore } from '../../src/store/integration.store'

const group: IntegrationGroup = {
  id: 'group-1',
  name: 'Checkout',
  goal: 'Deliver checkout',
  description: null,
  status: 'active',
  activeWorkspaceId: 'workspace-1',
  createdAt: 1,
  updatedAt: 1,
  members: [
    {
      id: 'member-web', groupId: 'group-1', workspaceId: 'workspace-1', workspaceName: 'Web', workspaceRootPath: 'C:/web', paneId: 'pane-web', rootPath: 'C:/web', role: 'fed', alias: 'Web', branch: 'main', activeProvider: null, activeSessionId: null, lastIntent: null, lastResult: null, blockers: null, updatedAt: 1
    },
    {
      id: 'member-api', groupId: 'group-1', workspaceId: 'workspace-2', workspaceName: 'API', workspaceRootPath: 'C:/api', paneId: 'pane-api', rootPath: 'C:/api', role: 'api', alias: 'API', branch: 'main', activeProvider: null, activeSessionId: null, lastIntent: null, lastResult: null, blockers: null, updatedAt: 1
    }
  ]
}

describe('HandoffInbox', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ groups: [group], handoffs: {}, activeGroupId: group.id, activeMemberId: 'member-web', isLoading: false, error: null })
    window.oxe = {
      integration: {
        listHandoffs: vi.fn().mockResolvedValue([]),
        createHandoff: vi.fn().mockResolvedValue({ id: 'handoff-1', groupId: group.id, fromMemberId: 'member-web', toMemberId: 'member-api', title: 'Validate contract', content: 'Validate the checkout contract.', status: 'sent', createdAt: 2 }),
        updateHandoff: vi.fn()
      }
    } as typeof window.oxe
  })

  test('creates a handoff from the visible composer', async () => {
    const user = userEvent.setup()
    render(<HandoffInbox group={group} currentMemberId="member-web" onSelectMember={() => undefined} />)

    await user.type(screen.getByLabelText('Subject'), 'Validate contract')
    await user.type(screen.getByLabelText('What should happen next?'), 'Validate the checkout contract.')
    await user.click(screen.getByRole('button', { name: 'Send handoff' }))

    expect(window.oxe.integration.createHandoff).toHaveBeenCalledWith(expect.objectContaining({
      groupId: group.id,
      fromMemberId: 'member-web',
      toMemberId: 'member-api',
      title: 'Validate contract',
      content: 'Validate the checkout contract.',
      status: 'sent'
    }))
  })
})
