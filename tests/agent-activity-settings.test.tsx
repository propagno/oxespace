import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentActivitySettings } from '../src/components/Settings/AgentActivitySettings'
import { useAgentActivityFilter } from '../src/store/agent-activity-filter.store'

afterEach(() => {
  cleanup()
  useAgentActivityFilter.getState().clear()
  delete (window as { oxe?: unknown }).oxe
})

function mount(rows: Array<Record<string, unknown>>, failedSources: string[] = []) {
  const list = vi.fn(async () => ({ rows, cursor: null, failedSources }))
  ;(window as unknown as { oxe: unknown }).oxe = { agentActivity: { list, detail: vi.fn(async () => null) } }
  render(<AgentActivitySettings />)
  return { list }
}

describe('AgentActivitySettings', () => {
  it('lists unified agent activity rows with what the person decided', async () => {
    mount([
      { id: 'changes:2', at: 0, actor: { id: 'thread:t1', name: 'Fix auth' }, source: 'changes', summary: 'git push main → origin/main', decision: 'approved', outcome: 'ok' },
      { id: 'changes:1', at: 0, actor: { id: 'pane:p1', name: 'Pane 1' }, source: 'changes', summary: 'create_release', decision: 'denied', outcome: 'skipped' }
    ])
    expect(await screen.findByText('git push main → origin/main')).toBeVisible()
    expect(screen.getByText('Fix auth')).toBeVisible()
    expect(screen.getByText('create_release')).toBeVisible()
  })

  it('shows the empty state when there are no activity rows or the bridge is absent', async () => {
    mount([])
    expect(await screen.findByTestId('agent-activity')).toBeVisible()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('filters by source when a source button is clicked', async () => {
    const { list } = mount([
      { id: 'http:1', at: 0, actor: 'thread:t1', source: 'http', summary: 'GET https://api.example/v1', decision: 'auto', outcome: 'ok' }
    ])
    await screen.findByText('GET https://api.example/v1')
    fireEvent.click(screen.getByRole('button', { name: 'HTTP' }))
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sources: ['http'] }))
  })
})
