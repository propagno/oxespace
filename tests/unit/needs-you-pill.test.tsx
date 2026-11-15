import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NeedsYouPill } from '../../src/components/Navigation/NeedsYouPill'
import { applyAgentsChange, pendingCount } from '../../src/components/Navigation/NeedsYouQueue'
import '../../src/i18n'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import type { AgentRow, AgentsChange } from '../../shared/types/agents'

const SOURCES = { panes: { ok: true, seq: 1 }, threads: { ok: true, seq: 1 }, delegations: { ok: true, seq: 1 }, work: { ok: true, seq: 1 } }
const pane = (id: string, state: string): AgentRow => ({ kind: 'pane', id, state, provider: 'claude', mode: 'code', title: 'Claude', workspaceId: 'ws-1', since: 1, seenAt: null, session: null, worktree: null, cost: null, requests: [] }) as unknown as AgentRow
const thread = (id: string, answerable: boolean[]): AgentRow => ({ kind: 'thread', id, state: 'needs-you', provider: 'codex', mode: 'thread', title: id, workspaceId: 'ws-1', since: 1, seenAt: null, session: null, worktree: null, cost: null,
  requests: answerable.map((value, index) => ({ requestId: `${id}-${index}`, kind: 'approval', title: { code: 'agents.request.approval', params: {} }, risk: 'low', reversible: null, answerable: value, since: index })) }) as unknown as AgentRow

let push: ((change: AgentsChange) => void) | null = null
function overview(agents: AgentRow[]): void {
  push = null
  Object.defineProperty(window, 'oxe', { configurable: true, value: { agents: { overview: vi.fn(async () => ({ agents, sources: SOURCES })), onChanged: vi.fn((listener: (change: AgentsChange) => void) => { push = listener; return () => undefined }), markSeen: vi.fn(async () => undefined) } } })
}

describe('NeedsYouPill (BRD-09, BRD-10)', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [] })
    overview([])
  })
  afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

  it('is not drawn while nothing waits', async () => {
    render(<NeedsYouPill />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByTestId('needs-you-pill')).toBeNull()
    expect(screen.queryByText('Nothing waiting')).toBeNull()
  })

  it('counts the queue\'s pending rows from main\'s overview and opens the queue on click', async () => {
    overview([thread('t-1', [true, false]), thread('t-2', [true]), pane('p-1', 'needs-you'), pane('p-2', 'working')])
    render(<NeedsYouPill />)
    const pill = await screen.findByTestId('needs-you-pill')
    expect(pill).toHaveTextContent('3 need you')
    fireEvent.click(pill)
    expect(document.querySelectorAll('[data-ui="needs-you-queue"]')).toHaveLength(1)
    expect(pill).toHaveAttribute('aria-expanded', 'true')
  })

  it('follows main\'s pushes: a request answered elsewhere leaves the count', async () => {
    overview([thread('t-1', [true]), pane('p-1', 'needs-you')])
    render(<NeedsYouPill />)
    await waitFor(() => expect(screen.getByTestId('needs-you-pill')).toHaveTextContent('2 need you'))
    push?.({ upsert: [], removed: [{ kind: 'thread', id: 't-1' }], sources: SOURCES } as AgentsChange)
    await waitFor(() => expect(screen.getByTestId('needs-you-pill')).toHaveTextContent('1 needs you'))
  })

  it('pendingCount and applyAgentsChange', () => {
    expect(pendingCount([thread('t', [true, true, false]), pane('a', 'needs-you'), pane('b', 'failed')])).toBe(3)
    const rows = [pane('a', 'working'), pane('b', 'working')]
    const next = applyAgentsChange(rows, { upsert: [pane('a', 'needs-you'), pane('c', 'idle')], removed: [{ kind: 'pane', id: 'b' }], sources: SOURCES } as AgentsChange)
    expect(next.map(row => `${row.id}:${row.state}`)).toEqual(['a:needs-you', 'c:idle'])
  })
})
