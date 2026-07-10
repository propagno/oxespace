import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { IntegrationMember } from '../../shared/types/integration'
import { MemberEditor } from '../../src/components/Integration/MemberEditor'

const member: IntegrationMember = {
  id: 'member-web',
  groupId: 'group-1',
  workspaceId: 'workspace-1',
  workspaceName: 'Web',
  workspaceRootPath: 'C:/web',
  paneId: 'pane-web',
  rootPath: 'C:/web',
  role: 'fed',
  alias: 'Web',
  branch: 'main',
  activeProvider: null,
  activeSessionId: null,
  lastIntent: null,
  lastResult: null,
  blockers: null,
  updatedAt: 1
}

describe('MemberEditor', () => {
  test('offers an explicit, confirmed member-removal action', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const { rerender } = render(
      <MemberEditor member={member} panes={[]} confirmingRemoval={false} isRemoving={false} onClose={() => undefined} onRemove={onRemove} />
    )

    await user.click(screen.getByRole('button', { name: 'Remove member' }))
    expect(onRemove).toHaveBeenCalledOnce()

    rerender(
      <MemberEditor member={member} panes={[]} confirmingRemoval isRemoving={false} onClose={() => undefined} onRemove={onRemove} />
    )
    expect(screen.getByRole('button', { name: 'Confirm removal' })).toBeInTheDocument()
  })
})
