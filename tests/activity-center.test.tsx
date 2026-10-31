import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityCenter } from '../src/components/Activity/ActivityCenter'
import { useActivityStore } from '../src/store/activity.store'
import { useThreadStore } from '../src/store/thread.store'
import { useUIStore } from '../src/store/ui.store'
import { useContributedCommands } from '../src/utils/commandRegistry'

describe('ActivityCenter', () => {
  beforeEach(() => {
    useActivityStore.getState().reset()
    const { record } = useActivityStore.getState()
    record({ source: 'update', id: '1.4.0', kind: 'update', target: { type: 'update', version: '1.4.0' }, title: 'OXESpace 1.4.0 is available', at: 1 })
    record({ source: 'background', id: 'job', kind: 'failed', target: { type: 'background', workspaceId: 'ws', jobId: 'job' }, title: 'Build', at: 2 })
    record({ source: 'thread', id: 't', kind: 'needs-you', target: { type: 'thread', threadId: 't' }, title: 'Fix the login bug', detail: 'Run npm test', at: 3 })
  })

  it('groups entries and counts the unread ones on the bell', () => {
    render(<ActivityCenter onSelectView={() => undefined} />)
    expect(screen.getByTestId('activity-count').textContent).toBe('3')
    fireEvent.click(screen.getByTestId('activity-bell'))
    expect(screen.getByRole('region', { name: 'Needs you' }).textContent).toContain('Fix the login bug')
    expect(screen.getByRole('region', { name: 'Finished' }).textContent).toContain('Build')
    expect(screen.getByRole('region', { name: 'Updates' }).textContent).toContain('OXESpace 1.4.0 is available')
  })

  it('opens the conversation an entry is about and marks it read', () => {
    const select = vi.spyOn(useThreadStore.getState(), 'select').mockResolvedValue()
    useThreadStore.setState({ select })
    const onSelectView = vi.fn()
    render(<ActivityCenter onSelectView={onSelectView} />)
    fireEvent.click(screen.getByTestId('activity-bell'))
    fireEvent.click(screen.getByRole('button', { name: /Fix the login bug/ }))
    expect(onSelectView).toHaveBeenCalledWith('thread')
    expect(select).toHaveBeenCalledWith('t')
    expect(useActivityStore.getState().items.find(item => item.id === 't')?.read).toBe(true)
  })

  it('sends quota and update entries to their Settings page', () => {
    const openSettingsPage = vi.fn()
    useUIStore.setState({ openSettingsPage })
    render(<ActivityCenter onSelectView={() => undefined} />)
    fireEvent.click(screen.getByTestId('activity-bell'))
    fireEvent.click(screen.getByRole('button', { name: /OXESpace 1.4.0/ }))
    expect(openSettingsPage).toHaveBeenCalledWith('updates')
  })

  it('marks everything read, and the palette has both commands', () => {
    render(<ActivityCenter onSelectView={() => undefined} />)
    fireEvent.click(screen.getByTestId('activity-bell'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(screen.queryByTestId('activity-count')).toBeNull()
    expect(renderHook(() => useContributedCommands()).result.current.map(command => command.id)).toEqual(expect.arrayContaining(['activity.open', 'activity.markAllRead']))
  })
})
