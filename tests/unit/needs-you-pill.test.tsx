import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OPEN_APPROVAL_QUEUE_EVENT } from '../../src/components/Approvals/approvalsBoot'
import { NeedsYouPill } from '../../src/components/Navigation/NeedsYouPill'
import '../../src/i18n'
import { useThreadStore } from '../../src/store/thread.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

describe('NeedsYouPill (Playground parity D1.2)', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [] })
    useThreadStore.setState({ threads: [], unreadIds: [] })
  })

  it('shows Nothing waiting when zero approvals are pending and dispatches OPEN_APPROVAL_QUEUE_EVENT on click', () => {
    const onOpen = vi.fn()
    window.addEventListener(OPEN_APPROVAL_QUEUE_EVENT, onOpen)
    try {
      render(<NeedsYouPill />)
      const pill = screen.getByTestId('needs-you-pill')
      expect(pill).toHaveTextContent('Nothing waiting')
      fireEvent.click(pill)
      expect(onOpen).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(OPEN_APPROVAL_QUEUE_EVENT, onOpen)
    }
  })

  it('shows the live count when threads need approval', () => {
    useThreadStore.setState({
      threads: [{ id: 'a', status: 'approval' }, { id: 'b', status: 'approval' }] as never
    })
    render(<NeedsYouPill />)
    expect(screen.getByTestId('needs-you-pill')).toHaveTextContent('2 need you')
  })
})
