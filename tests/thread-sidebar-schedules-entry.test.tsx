import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadSidebar } from '../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../src/store/thread.store'
import { useUIStore } from '../src/store/ui.store'
import type { ConversationThread, ThreadApi } from '../shared/types/thread'

const thread = { id: 'a', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Alpha', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 } as unknown as ConversationThread

beforeEach(() => {
  localStorage.clear(); resetSectionsForTests()
  const api = { list: vi.fn(async () => [thread]), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), onChanged: vi.fn(() => () => {}), sections: vi.fn(async () => ({ sections: [], assignments: {} })), saveSections: vi.fn() } as unknown as ThreadApi
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api } })
  useThreadStore.setState({ threads: [thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], selectedId: null } as never)
  useUIStore.getState().closeSchedules()
})
afterEach(() => cleanup())

describe('the way to Schedules in the conversation sidebar', () => {
  it('is one of the header actions, beside Add project, and opens Schedules', () => {
    const { container } = render(<ThreadSidebar onCreate={vi.fn()} />)
    const actions = container.querySelector('.nav-panel-title .sidebar-actions') as HTMLElement
    expect([...actions.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(['Add project', 'Schedules'])
    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }))
    expect(useUIStore.getState().isSchedulesOpen).toBe(true)
  })

  it('leaves the strip under the list to its two counts, which stay on one line in any language', () => {
    render(<ThreadSidebar onCreate={vi.fn()} />)
    const strip = screen.getByText(/^Archived/).parentElement as HTMLElement
    expect(strip.querySelectorAll('button')).toHaveLength(0)
    expect([...strip.children].map(child => child.textContent)).toEqual(['Archived · 0', '1 conversation'])
  })
})
