// Frozen acceptance test for 1.5.0 A11 (U12, T63; OXE phase F2). The executor must not edit it.
// Contract: docs/roadmap-1.5/ccr-a11-agent-activity-page.md, reading BACKEND's A10 read model (CCR #650).
// Settings › Agent activity is one list from every source, from one `agentActivity.list` call per page; the renderer
// never merges lists.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentActivitySettings } from '../../../src/components/Settings/AgentActivitySettings'

type Row = {
  id: string; source: 'changes' | 'databases' | 'containers' | 'post'; at: number
  actor: { kind: 'thread' | 'pane' | 'agent' | 'person'; id: string | null; label: string; name: string | null }
  tool: string; summary: string; target: string | null; write: boolean
  decision: 'auto' | 'approved' | 'approved-session' | 'denied' | 'refused' | 'pending'
  outcome: 'ok' | 'error' | 'skipped'; durationMs: number | null; errorCode: string | null
}
const at = Date.UTC(2026, 10, 7, 14, 40)
const ROWS: Row[] = [
  { id: 'changes:7', source: 'changes', at, actor: { kind: 'thread', id: 't1', label: 'thread:t1', name: 'Make charge creation idempotent' }, tool: 'oxespace_workspace_change', summary: 'rename · cajui-api', target: 'cajui-api', write: true, decision: 'auto', outcome: 'ok', durationMs: 40, errorCode: null },
  { id: 'databases:3', source: 'databases', at: at - 60_000, actor: { kind: 'pane', id: 'p2', label: 'pane:p2', name: null }, tool: 'oxespace_db_execute', summary: 'DELETE FROM pix_mock_data', target: 'cajui-dev', write: true, decision: 'denied', outcome: 'skipped', durationMs: null, errorCode: null },
  { id: 'containers:9', source: 'containers', at: at - 120_000, actor: { kind: 'agent', id: null, label: 'claude', name: null }, tool: 'oxespace_container_action', summary: 'restart api', target: 'api', write: true, decision: 'approved', outcome: 'error', durationMs: 5000, errorCode: 'E_TIMEOUT' },
  { id: 'post:2', source: 'post', at: at - 180_000, actor: { kind: 'thread', id: 't1', label: 'thread:t1', name: 'Make charge creation idempotent' }, tool: 'oxespace_post_send', summary: 'POST /pix/charges', target: 'Pix · sandbox', write: true, decision: 'pending', outcome: 'skipped', durationMs: null, errorCode: null }
]

function fake(pages: Array<{ rows: Row[]; nextCursor: string | null }> = [{ rows: ROWS, nextCursor: null }]) {
  let call = 0
  const api = {
    list: vi.fn(async () => pages[Math.min(call++, pages.length - 1)]),
    detail: vi.fn(async (id: string) => ({ ...ROWS.find(row => row.id === id)! }))
  }
  // No mcpInternal: the page must not reach the old per-source lists.
  ;(window as unknown as { oxe: unknown }).oxe = { agentActivity: api }
  return api
}
const control = (name: string): HTMLElement =>
  screen.queryByRole('radio', { name }) ?? screen.queryByRole('tab', { name }) ?? screen.getByRole('button', { name })

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

describe('A11 · Settings › Agent activity is one list from every source', () => {
  it('asks the read model once for everything, and never the old lists', async () => {
    const api = fake()
    render(<AgentActivitySettings />)
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1))
    const query = api.list.mock.calls[0][0] as Record<string, unknown>
    expect(query.sources).toBeUndefined()
    expect(query.view ?? 'all').toBe('all')
    expect(query.cursor).toBeUndefined()
  })

  it('shows one table with the same six columns for every source, in the order the read model gave', async () => {
    fake()
    render(<AgentActivitySettings />)
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent?.trim()))
      .toEqual(['When', 'Agent', 'Source', 'What', 'Target', 'Result'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map(row => within(row).getAllByRole('cell')[3].textContent)).toEqual(ROWS.map(row => row.summary))
    expect(rows.map(row => within(row).getAllByRole('cell')[2].textContent)).toEqual(['Changes', 'Databases', 'Containers', 'Requests'])
  })

  it('says what came of each entry in the same words for every source', async () => {
    fake()
    render(<AgentActivitySettings />)
    const table = await screen.findByRole('table')
    const results = within(table).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[5].textContent?.trim())
    expect(results).toEqual(['Done', 'Denied', 'Failed · E_TIMEOUT', 'Waiting for you'])
  })

  it('filters on the server: a source and a view each start again from the first page', async () => {
    const api = fake()
    const user = userEvent.setup()
    render(<AgentActivitySettings />)
    await screen.findByRole('table')
    await user.click(control('Databases'))
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
    expect(api.list.mock.calls[1][0]).toMatchObject({ sources: ['databases'] })
    expect((api.list.mock.calls[1][0] as Record<string, unknown>).cursor).toBeUndefined()
    await user.click(control('Problems'))
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3))
    expect(api.list.mock.calls[2][0]).toMatchObject({ sources: ['databases'], view: 'problems' })
    expect((api.list.mock.calls[2][0] as Record<string, unknown>).cursor).toBeUndefined()
  })

  it('loads the next page with the cursor and appends it; no Load more on the last page', async () => {
    const api = fake([{ rows: ROWS.slice(0, 2), nextCursor: 'djE6Mg' }, { rows: ROWS.slice(2), nextCursor: null }])
    const user = userEvent.setup()
    render(<AgentActivitySettings />)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
    expect(api.list.mock.calls[1][0]).toMatchObject({ cursor: 'djE6Mg' })
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1 + ROWS.length))
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('opens the detail of a row in a dialog named by what it did', async () => {
    const api = fake()
    const user = userEvent.setup()
    render(<AgentActivitySettings />)
    const table = await screen.findByRole('table')
    await user.click(within(table).getAllByRole('row')[2])
    await waitFor(() => expect(api.detail).toHaveBeenCalledWith('databases:3'))
    expect(await screen.findByRole('dialog', { name: 'DELETE FROM pix_mock_data' })).toBeInTheDocument()
  })

  it('names the person\'s own change "You" in the Agent column (A12\'s Access changed)', async () => {
    const person: Row = { id: 'post:5', source: 'post', at, actor: { kind: 'person', id: null, label: 'person', name: null }, tool: 'post.access', summary: 'Access changed · Pix', target: 'Pix · sandbox', write: true, decision: 'auto', outcome: 'ok', durationMs: null, errorCode: null }
    fake([{ rows: [person], nextCursor: null }])
    render(<AgentActivitySettings />)
    const table = await screen.findByRole('table')
    const agent = within(within(table).getAllByRole('row')[1]).getAllByRole('cell')[1]
    expect(agent.textContent?.trim()).toBe('You')
  })

  it('names the agent by the name A10 resolves, with a fallback and never the raw thread:/pane: label', async () => {
    fake()
    render(<AgentActivitySettings />)
    const table = await screen.findByRole('table')
    const agents = within(table).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[1].textContent?.trim() ?? '')
    expect(agents[0]).toBe('Make charge creation idempotent')
    expect(agents[1]).toBe('Closed terminal')
    expect(agents[2]).toMatch(/claude/i)
    expect(agents[3]).toBe('Make charge creation idempotent')
    for (const agent of agents) expect(agent).not.toMatch(/^(thread|pane):/)
  })

  it('never reads a second list to merge: no old audit channels in the page', () => {
    const source = readFileSync(join(__dirname, '..', '..', '..', 'src/components/Settings/AgentActivitySettings.tsx'), 'utf8')
    expect(source).not.toMatch(/actionAudit\s*\(/)
    expect(source).not.toMatch(/oxequery[\s\S]{0,40}audit/i)
    expect(source).toMatch(/agentActivity\??\.list/)
  })
})
