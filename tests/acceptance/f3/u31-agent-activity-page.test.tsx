// Frozen acceptance test for 1.5.0 A11 (DESIGN U3.1, OXE program, phase F3, task FE-A11). Written by the planner; the
// executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f3-design.md (U3.1), TECH LEAD's G-a..G-d (08/11).
// Contract (BACKEND A10, #695 + amendment): window.oxe.agentActivity.list(AgentActivityQuery) → AgentActivityPage
// { rows (≤ 50), cursor | null, failedSources }, detail(id) → AgentActivityDetail | null. http rows carry `status`; edit
// rows carry `path`, `line`, `added`, `removed`. Main pages and filters; the renderer never merges lists.
// The page is AgentActivitySettings (src/components/Settings/AgentActivitySettings.tsx). resultChip(row, live?) lives in
// src/components/Settings/agentActivityModel.ts. The live reads (is the change still in the working tree, is the container
// still there) go through src/components/Settings/agentActivityLive.ts, mocked here.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'

const live = vi.hoisted(() => ({
  changeInWorkingTree: vi.fn(async (_workspaceId: string, _path: string) => true),
  liveContainer: vi.fn(async (_name: string): Promise<{ image: string; ports: string; folder: string } | null> => ({ image: 'postgres:16', ports: '5433→5432', folder: '/repo/infra' }))
}))
vi.mock('../../../src/components/Settings/agentActivityLive', () => live)

type Row = Record<string, unknown>
const TODAY = Date.now()
const row = (id: string, source: string, o: Row = {}): Row => ({
  id, source, at: TODAY - 60_000, agent: 'claude-code', workspaceId: 'ws-1', write: false, decision: 'auto', outcome: 'ok', errorCode: null,
  actor: { kind: 'thread', id: 't-1', name: 'Fix the checkout', gone: false }, summary: `${source} ${id}`, target: 'x', detailRef: id, ...o
})
const FOUR = [
  row('c1', 'changes', { summary: 'src/app.ts', path: 'src/app.ts', line: 41, added: 12, removed: 3, write: true }),
  row('d1', 'databases', { summary: 'SELECT * FROM orders', decision: 'pending', outcome: null }),
  row('h1', 'http', { summary: 'POST api.example.com/v1/charges/:id', status: 201, write: true }),
  row('k1', 'containers', { summary: 'billing-db', outcome: 'running' })
]
const DETAILS: Record<string, Row> = {
  c1: { source: 'changes', tool: 'Edit', action: 'edit', level: 'write', text: 'src/app.ts', decision: 'auto', outcome: 'ok', durationMs: null, errorCode: null, path: 'src/app.ts', line: 41, added: 12, removed: 3 },
  d1: { source: 'databases', tool: 'oxespace_db_query', connectionId: 'c-shop', connectionName: 'shop', engine: 'postgres', environment: 'dev', text: 'SELECT * FROM orders', decision: 'pending', outcome: null, rowCount: 3, durationMs: 12, errorCode: null },
  k1: { source: 'containers', tool: 'oxespace_container_action', connectionId: null, connectionName: null, engine: null, environment: null, text: 'start billing-db', decision: 'auto', outcome: 'running', rowCount: null, durationMs: null, errorCode: null }
}

function mockActivity(list: (query: Row) => unknown) {
  const api = { list: vi.fn(async (query: Row) => list(query)), detail: vi.fn(async (id: string) => DETAILS[id] ?? null), badge: vi.fn(async () => ({ today: 0, waiting: false })) }
  const openIn = vi.fn(async () => undefined)
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, agentActivity: api, app: { platform: 'win32', openIn, openInTargets: async () => ({ editors: [{ id: 'vscode', name: 'VS Code' }], preferred: 'vscode' }) } } })
  return { api, openIn }
}
async function renderPage() {
  const { AgentActivitySettings } = await import('../../../src/components/Settings/AgentActivitySettings')
  render(<AgentActivitySettings />)
}
const tableRows = (): HTMLElement[] => screen.getAllByRole('row').filter(element => element.closest('tbody'))
async function openDetail(index: number, name: string | RegExp): Promise<HTMLElement> {
  await waitFor(() => expect(tableRows().length).toBeGreaterThan(index))
  const target = tableRows()[index]
  target.focus()
  fireEvent.keyDown(target, { key: 'Enter' })
  return screen.findByRole('dialog', { name })
}

// Modules this task creates load at run time, so a missing one fails its own checks, not the whole file.
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('U3.1 · Settings › Agent activity, one list from every source', () => {
  test('All lists the four sources in one table with the same columns, and each source chip asks main once', async () => {
    const { api } = mockActivity(() => ({ rows: FOUR, cursor: null, failedSources: [] }))
    await renderPage()
    await waitFor(() => expect(tableRows()).toHaveLength(4))
    const headers = screen.getAllByRole('columnheader').map(header => header.textContent?.trim())
    expect(headers).toEqual(expect.arrayContaining(['When', 'Conversation', 'What', 'Result']))
    for (const text of ['src/app.ts', 'SELECT * FROM orders', 'POST api.example.com/v1/charges/:id', 'billing-db']) expect(screen.getAllByText(text).length).toBeGreaterThan(0)
    const calls = api.list.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: /^Databases/ }))
    await waitFor(() => expect(api.list.mock.calls.length).toBe(calls + 1))
    expect(api.list.mock.calls.at(-1)?.[0]).toMatchObject({ sources: ['databases'] })
  })

  test('Load more asks main for the next cursor, and the last page hides it', async () => {
    const all = Array.from({ length: 120 }, (_, index) => row(`r${index}`, 'databases', { summary: `SELECT ${index}` }))
    const { api } = mockActivity(query => {
      const start = query.cursor ? Number(query.cursor) : 0
      return { rows: all.slice(start, start + 50), cursor: start + 50 < all.length ? String(start + 50) : null, failedSources: [] }
    })
    await renderPage()
    await waitFor(() => expect(tableRows()).toHaveLength(50))
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(tableRows()).toHaveLength(100))
    expect(api.list.mock.calls.at(-1)?.[0]).toMatchObject({ cursor: '50' })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(tableRows()).toHaveLength(120))
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  test('a failing source shows one Notice, a dash on its chip and the other sources, and Try again asks main again', async () => {
    const { api } = mockActivity(() => ({ rows: FOUR.filter(item => item.source !== 'http'), cursor: null, failedSources: ['http'] }))
    await renderPage()
    expect(await screen.findByText("Some sources couldn't be read. The rest is up to date.")).toBeInTheDocument()
    expect(screen.getAllByText("Some sources couldn't be read. The rest is up to date.")).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^HTTP/ }).textContent).toMatch(/—/)
    expect(tableRows()).toHaveLength(3)
    const calls = api.list.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.list.mock.calls.length).toBe(calls + 1))
  })

  test('Enter on a row opens the detail with focus inside and no action that changes anything, and Escape gives focus back', async () => {
    mockActivity(() => ({ rows: FOUR, cursor: null, failedSources: [] }))
    await renderPage()
    const dialog = await openDetail(1, 'SELECT * FROM orders')
    const target = tableRows()[1]
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(within(dialog).getByText(/shop/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Approve|Allow|Deny|Delete|Run|Aprovar|Negar/ })).toBeNull()
    act(() => { fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(target))
  })

  test('the Result chip reads the row: databases by decision, HTTP by status, containers, and changes as +N −M', async () => {
    const { resultChip } = await load<{ resultChip: (row: Row, live?: Row) => { label: string; tone: string } }>('src/components/Settings/agentActivityModel')
    expect(resultChip(row('a', 'databases', { decision: 'approved', outcome: 'ok' }))).toEqual({ label: 'Done', tone: 'neutral' })
    expect(resultChip(row('b', 'databases', { decision: 'pending', outcome: null }))).toEqual({ label: 'Waiting for you', tone: 'attn' })
    expect(resultChip(row('c', 'databases', { decision: 'denied', outcome: null }))).toEqual({ label: 'Denied', tone: 'neutral' })
    expect(resultChip(row('d', 'databases', { decision: 'blocked', outcome: null, errorCode: 'policy' }))).toEqual({ label: 'Not allowed', tone: 'danger' })
    expect(resultChip(row('e', 'databases', { decision: 'approved', outcome: 'error', errorCode: 'syntax' }))).toEqual({ label: 'Failed', tone: 'danger' })
    expect(resultChip(row('f', 'http', { status: 201 }))).toEqual({ label: '201', tone: 'success' })
    expect(resultChip(row('g', 'http', { status: 502, outcome: 'error' }))).toEqual({ label: '502', tone: 'danger' })
    expect(resultChip(row('h', 'http', { status: null }))).toEqual({ label: 'No status', tone: 'neutral' })
    expect(resultChip(row('i', 'containers', { outcome: 'running' }))).toEqual({ label: 'Running', tone: 'neutral' })
    expect(resultChip(row('j', 'containers', { outcome: 'exited' }))).toEqual({ label: 'Exited', tone: 'neutral' })
    expect(resultChip(row('k', 'containers', { outcome: 'running' }), { containerGone: true })).toEqual({ label: 'No longer running', tone: 'muted' })
    expect(resultChip(row('l', 'changes', { added: 12, removed: 3 }))).toEqual({ label: '+12 −3', tone: 'neutral' })
    expect(resultChip(row('m', 'changes', { added: 12, removed: 3 }), { changeGone: true })).toEqual({ label: '—', tone: 'muted' })
  })

  test('a change still in the working tree offers Open in editor at its first changed line', async () => {
    const { openIn } = mockActivity(() => ({ rows: FOUR, cursor: null, failedSources: [] }))
    await renderPage()
    const dialog = await openDetail(0, 'src/app.ts')
    await waitFor(() => expect(live.changeInWorkingTree).toHaveBeenCalledWith('ws-1', 'src/app.ts'))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Open in editor at line 41' }))
    await waitFor(() => expect(openIn).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/app.ts', line: 41 })))
  })

  test('a change no longer in the working tree says so, with no Open in editor', async () => {
    live.changeInWorkingTree.mockResolvedValueOnce(false)
    mockActivity(() => ({ rows: FOUR, cursor: null, failedSources: [] }))
    await renderPage()
    const dialog = await openDetail(0, 'src/app.ts')
    expect(await within(dialog).findByText("This change isn't in the working tree any more: it was committed, undone or moved.")).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Open in editor/ })).toBeNull()
  })

  test('a container detail shows its image, ports and folder live, and a removed one says only its name is kept', async () => {
    mockActivity(() => ({ rows: FOUR, cursor: null, failedSources: [] }))
    await renderPage()
    let dialog = await openDetail(3, 'billing-db')
    expect(await within(dialog).findByText(/postgres:16/)).toBeInTheDocument()
    expect(within(dialog).getByText(/5433→5432/)).toBeInTheDocument()
    expect(within(dialog).getByText(/\/repo\/infra/)).toBeInTheDocument()
    act(() => { fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    live.liveContainer.mockResolvedValueOnce(null)
    dialog = await openDetail(3, 'billing-db')
    expect(await within(dialog).findByText('This container was removed. Only its name and start time are kept.')).toBeInTheDocument()
    expect(within(dialog).queryByText(/postgres:16/)).toBeNull()
  })

  test('a removed conversation reads "(removed)" in muted text, with no link', async () => {
    mockActivity(() => ({ rows: [row('g1', 'databases', { actor: { kind: 'thread', id: 't-x', name: 'Old work', gone: true }, summary: 'SELECT 1' })], cursor: null, failedSources: [] }))
    await renderPage()
    const cell = await screen.findByText(/Old work/)
    expect(cell.closest('tr')?.textContent).toMatch(/Old work.*\(removed\)/)
    expect(cell.closest('a')).toBeNull()
  })

  test('the empty states: no activity yet, and nothing matching with Clear filters', async () => {
    const { api } = mockActivity(() => ({ rows: [], cursor: null, failedSources: [] }))
    await renderPage()
    expect(await screen.findByText('No agent activity yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Databases/ }))
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
    const calls = api.list.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(api.list.mock.calls.length).toBe(calls + 1))
    expect(api.list.mock.calls.at(-1)?.[0]).not.toHaveProperty('sources', ['databases'])
  })
})
