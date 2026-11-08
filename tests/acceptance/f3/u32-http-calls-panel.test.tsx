// Frozen acceptance test for 1.5.0 A12 and A59 on screen (DESIGN U3.2, OXE program, phase F3, task FE-H2). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f3-design.md (U3.2).
// Contract (BACKEND H2-data, #695 + its 08/11 amendment): window.oxe.httpAudit.list(HttpAuditQuery) → HttpAuditPage
// { rows: HttpAuditRow[], cursor, hosts: [{ host, count, production }] }. Main filters (view, filter, actor) and masks;
// the renderer only shows what arrives. The panel is HttpCallsPanel({ workspaceId, actor? }) in
// src/components/HttpCalls/HttpCallsPanel.tsx; the conversation's Network tab is ThreadNetworkPanel({ threadId, workspaceId })
// in src/components/Threads/ThreadNetworkPanel.tsx (the same panel with actor thread:<id>), panel 'network' in the workbench store.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Row = Record<string, unknown>
const at = (hour: number, minute: number): number => { const date = new Date(); date.setHours(hour, minute, 0, 0); return date.getTime() }
const call = (id: number, o: Row = {}): Row => ({
  id, at: at(14, 40), actor: { kind: 'thread', id: 't-1', name: 'Fix the checkout', gone: false }, workspaceId: 'ws-1', agent: 'claude-code',
  sourceKind: 'hook', tool: 'Bash', method: 'POST', scheme: 'https', host: 'api.stripe.test', port: 443, pathTemplate: '/v1/charges/:id',
  queryKeys: [], headerNames: ['Content-Type', '•••• (Authorization)'], hasBody: true, bodyBytes: 214, status: 201, durationMs: 84,
  insecure: false, plainHttpExternal: false, outputTruncated: false, production: false,
  commandRedacted: 'curl -X POST https://api.stripe.test/v1/charges/ch_1 -H "Authorization: ••••" -d @f', ...o
})
const ROWS = [
  call(1),
  call(2, { method: 'GET', host: 'db.prod.test', pathTemplate: '/health', status: null, durationMs: null, production: true, at: at(14, 35) }),
  call(3, { method: 'GET', scheme: 'http', host: 'legacy.example.com', pathTemplate: '/v1/items', insecure: true, plainHttpExternal: true, sourceKind: 'rollout', at: at(14, 30) })
]
const HOSTS = [{ host: 'api.stripe.test', count: 1, production: false }, { host: 'db.prod.test', count: 1, production: true }, { host: 'legacy.example.com', count: 1, production: false }]

function mockAudit(page: (query: Row) => unknown = () => ({ rows: ROWS, cursor: null, hosts: HOSTS })) {
  const list = vi.fn(async (query: Row) => page(query))
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, httpAudit: { list } } })
  return list
}
async function renderPanel(actor?: string) {
  const { HttpCallsPanel } = await load<{ HttpCallsPanel: (props: { workspaceId: string; actor?: string }) => JSX.Element }>('src/components/HttpCalls/HttpCallsPanel')
  render(<HttpCallsPanel workspaceId="ws-1" {...(actor ? { actor } : {})} />)
}

// Modules this task creates load at run time, so a missing one fails its own checks, not the whole file.
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('U3.2 · the HTTP calls panel and the Network tab', () => {
  test('a curl POST shows its method, host, path template, header names with Authorization masked and the body size, never the body', async () => {
    mockAudit()
    await renderPanel()
    expect(await screen.findByRole('heading', { name: /api\.stripe\.test/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^POST \/v1\/charges\/:id, 201, Claude, 14:40/ }))
    expect(await screen.findByText(/Content-Type, •••• \(Authorization\)/)).toBeInTheDocument()
    expect(screen.getByText(/214 B/)).toBeInTheDocument()
    expect(screen.getByText(/201 · 84 ms/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Bearer|ch_1"|"amount"/)
  })

  test('Errors and Flagged are toggle buttons that ask main for that view, and the filter field asks main for host or path', async () => {
    const list = mockAudit()
    await renderPanel()
    await screen.findByRole('heading', { name: /api\.stripe\.test/ })
    const errors = screen.getByRole('button', { name: 'Errors' })
    expect(errors).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('radio', { name: 'Errors' })).toBeNull()
    await userEvent.click(errors)
    await waitFor(() => expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceId: 'ws-1', view: 'errors' }))
    expect(screen.getByRole('button', { name: 'Errors' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Flagged' }))
    await waitFor(() => expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ view: 'flagged' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter by host or path' }), 'charges')
    await waitFor(() => expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ filter: 'charges' }))
  })

  test("a conversation's Network tab asks main for that conversation's calls only", async () => {
    const list = mockAudit()
    const { ThreadNetworkPanel } = await load<{ ThreadNetworkPanel: (props: { threadId: string; workspaceId: string }) => JSX.Element }>('src/components/Threads/ThreadNetworkPanel')
    render(<ThreadNetworkPanel threadId="t-1" workspaceId="ws-1" />)
    expect(await screen.findByRole('heading', { name: /api.stripe.test/ })).toBeInTheDocument()
    expect(list.mock.calls.length).toBeGreaterThan(0)
    expect(list.mock.calls.every(([query]) => query.actor === 'thread:t-1' && query.workspaceId === 'ws-1')).toBe(true)
    const { useThreadWorkbenchStore } = await import('../../../src/store/thread-workbench.store')
    useThreadWorkbenchStore.getState().setView('t-1', { panel: 'network' as never })
    expect(useThreadWorkbenchStore.getState().views['t-1']?.panel).toBe('network')
  })

  test('a Codex call read after the turn says so, and a call with no status line says No status', async () => {
    mockAudit()
    await renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /^GET \/v1\/items/ }))
    expect(await screen.findByText('Read after the turn')).toBeInTheDocument()
    expect(screen.getAllByText('No status').length).toBeGreaterThan(0)
  })

  test('production, plain HTTP and TLS-not-checked calls carry their pills and callouts', async () => {
    mockAudit()
    await renderPanel()
    const prod = (await screen.findByRole('heading', { name: /db\.prod\.test/ })).closest('section') as HTMLElement
    expect(within(prod).getByText('production')).toBeInTheDocument()
    expect(screen.getByText('Not encrypted')).toBeInTheDocument()
    expect(screen.getByText('TLS not checked')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^GET \/health/ }))
    expect(await screen.findByText('A production host.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^GET \/v1\/items/ }))
    expect(await screen.findByText('Sent without TLS to a host outside this computer.')).toBeInTheDocument()
  })

  test('no Block or Allow control exists anywhere in the HTTP calls UI', async () => {
    mockAudit()
    await renderPanel()
    for (const name of [/^POST \/v1\/charges/, /^GET \/health/, /^GET \/v1\/items/]) {
      await userEvent.click(await screen.findByRole('button', { name }))
      expect(screen.queryByRole('button', { name: /Block|Allow|Bloquear|Permitir/ })).toBeNull()
    }
  })

  test('the empty, empty-after-filter and error states read as DESIGN wrote them', async () => {
    mockAudit(() => ({ rows: [], cursor: null, hosts: [] }))
    await renderPanel()
    expect(await screen.findByText('No HTTP calls yet. curl, wget and HTTPie calls from agents show up here.')).toBeInTheDocument()
    cleanup()
    mockAudit(query => ({ rows: query.filter ? [] : ROWS, cursor: null, hosts: query.filter ? [] : HOSTS }))
    await renderPanel()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Filter by host or path' }), 'nope')
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    cleanup()
    mockAudit(() => { throw new Error('db locked') })
    await renderPanel()
    expect(await screen.findByText("Couldn't read the HTTP log")).toBeInTheDocument()
  })

  test("conversation X's Network tab shows only X's call, and Agent activity's HTTP chip shows both", async () => {
    const x = call(10, { actor: { kind: 'thread', id: 't-x', name: 'Conversation X', gone: false }, pathTemplate: '/v1/x' })
    const y = call(11, { actor: { kind: 'thread', id: 't-y', name: 'Conversation Y', gone: false }, pathTemplate: '/v1/y' })
    const list = mockAudit(query => {
      const rows = [x, y].filter(item => !query.actor || query.actor === `thread:${(item.actor as { id: string }).id}`)
      return { rows, cursor: null, hosts: [{ host: 'api.stripe.test', count: rows.length, production: false }] }
    })
    const { ThreadNetworkPanel } = await load<{ ThreadNetworkPanel: (props: { threadId: string; workspaceId: string }) => JSX.Element }>('src/components/Threads/ThreadNetworkPanel')
    render(<ThreadNetworkPanel threadId="t-x" workspaceId="ws-1" />)
    expect(await screen.findByRole('button', { name: /^POST \/v1\/x/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^POST \/v1\/y/ })).toBeNull()
    expect(list.mock.calls.every(([query]) => query.actor === 'thread:t-x')).toBe(true)
    cleanup()
    const activityRow = (item: Row) => ({ id: `h${item.id}`, source: 'http', at: item.at, actor: item.actor, agent: 'claude-code', workspaceId: 'ws-1', summary: `POST api.stripe.test${item.pathTemplate}`, target: 'api.stripe.test', write: true, decision: 'auto', outcome: 'ok', errorCode: null, detailRef: `h${item.id}`, status: 201 })
    const activity = { list: vi.fn(async () => ({ rows: [activityRow(x), activityRow(y)], cursor: null, failedSources: [] })), detail: vi.fn(async () => null), badge: vi.fn(async () => ({ today: 0, waiting: false })) }
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, agentActivity: activity } })
    const { AgentActivitySettings } = await import('../../../src/components/Settings/AgentActivitySettings')
    render(<AgentActivitySettings />)
    await userEvent.click(await screen.findByRole('button', { name: /^HTTP/ }))
    await waitFor(() => expect(activity.list.mock.calls.at(-1)?.[0]).toMatchObject({ sources: ['http'] }))
    expect(await screen.findByText('POST api.stripe.test/v1/x')).toBeInTheDocument()
    expect(screen.getByText('POST api.stripe.test/v1/y')).toBeInTheDocument()
  })

  test("the detail's Open the conversation opens that conversation", async () => {
    mockAudit()
    const { useThreadStore } = await import('../../../src/store/thread.store')
    const select = vi.fn(async () => undefined)
    useThreadStore.setState({ select } as never)
    await renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /^POST \/v1\/charges\/:id/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open the conversation' }))
    await waitFor(() => expect(select).toHaveBeenCalledWith('t-1'))
  })
})
