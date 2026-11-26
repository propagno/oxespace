import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ThreadSnapshot } from '../../shared/types/thread'
import { useThreadWorkbenchStore } from '../../src/store/thread-workbench.store'

const mountCount = vi.fn()
const unmountCount = vi.fn()

vi.mock('../../src/components/Threads/ThreadChangesPanel', () => ({
  ThreadChangesPanel: ({ maximized, onToggleMaximized }: { maximized?: boolean; onToggleMaximized?: () => void }) => {
    const [token, setToken] = useState('initial')
    useEffect(() => {
      mountCount()
      return () => { unmountCount() }
    }, [])
    return (
      <div data-testid="spy-panel" data-maximized={String(Boolean(maximized))}>
        <span data-testid="spy-token">{token}</span>
        <button type="button" onClick={() => setToken('configured')}>configure</button>
        <button type="button" onClick={onToggleMaximized}>toggle-max</button>
      </div>
    )
  }
}))

import ThreadReviewHost from '../../src/components/Threads/ThreadReviewHost'

const snapshot = {
  thread: { id: 'thread-1', title: 'Test', provider: 'antigravity', workspaceId: 'ws-1', rootPath: '/repo' }
} as unknown as ThreadSnapshot

describe('ThreadReviewHost maximize lifecycle (OXE-442)', () => {
  afterEach(() => {
    cleanup()
    mountCount.mockClear()
    unmountCount.mockClear()
    useThreadWorkbenchStore.getState().setMaximized(null)
  })

  it('keeps the panel mounted without remounting or losing state when toggling maximize and restore', () => {
    const { container } = render(
      <ThreadReviewHost
        snapshot={snapshot}
        panel="preview"
        drawer={false}
        availableWidth={1280}
        workbench={{ current: null }}
        onClose={vi.fn()}
        onReturnFocus={vi.fn()}
        onSendToConversation={vi.fn()}
      />
    )

    expect(mountCount).toHaveBeenCalledTimes(1)
    expect(unmountCount).toHaveBeenCalledTimes(0)
    expect(container.querySelector('.thread-review-host')?.classList.contains('is-maximized')).toBe(false)
    expect(container.querySelector('[role="separator"]')).not.toBeNull()

    fireEvent.click(screen.getByText('configure'))
    expect(screen.getByTestId('spy-token').textContent).toBe('configured')

    // Maximize: host switches to .is-maximized, splitter hides, child stays mounted with intact state.
    fireEvent.click(screen.getByText('toggle-max'))
    expect(container.querySelector('.thread-review-host')?.classList.contains('is-maximized')).toBe(true)
    expect(container.querySelector('[role="separator"]')).toBeNull()
    expect(screen.getByTestId('spy-panel').getAttribute('data-maximized')).toBe('true')
    expect(screen.getByTestId('spy-token').textContent).toBe('configured')
    expect(mountCount).toHaveBeenCalledTimes(1)
    expect(unmountCount).toHaveBeenCalledTimes(0)

    // Restore: splitter returns, child STILL stays mounted with intact state.
    fireEvent.click(screen.getByText('toggle-max'))
    expect(container.querySelector('.thread-review-host')?.classList.contains('is-maximized')).toBe(false)
    expect(container.querySelector('[role="separator"]')).not.toBeNull()
    expect(screen.getByTestId('spy-panel').getAttribute('data-maximized')).toBe('false')
    expect(screen.getByTestId('spy-token').textContent).toBe('configured')
    expect(mountCount).toHaveBeenCalledTimes(1)
    expect(unmountCount).toHaveBeenCalledTimes(0)
  })
})
