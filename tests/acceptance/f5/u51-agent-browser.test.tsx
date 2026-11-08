// Frozen acceptance test for 1.5.0 A49 and A50 on screen (DESIGN U5.1, OXE program, phase F5, task FE-B1). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f5-design.md (U5.1).
// Contract (BACKEND #711 @ ac13dfec, §Contract): the existing window.oxe.browserPreview.onEvent stream gains
// { type: 'grant', grant | null }, { type: 'agent-action', phase, action: { id, kind, label, value?, at }, result? } (a fill reads
// "label: value", value already •••• for a password), { type: 'console', row: { level: 'error'|'warning'|'info', message, source,
// line }, at } and { type: 'network', row: { method, url, status, type, ms }, at }
// and { type: 'broker', attached, devToolsOpen }, each with ownerKey and tabId; browserPreview.revokeGrant({ ownerKey, tabId }).
// Main masks console text and query values before they arrive. The renderer parts:
// - AgentBrowserChrome({ ownerKey, tabId, agentName }) in src/components/WebPreview/AgentBrowserChrome.tsx (the agent strip,
//   the step strip, and the Console and Network chips with their drawers);
// - PreviewEmptyState({ kind: 'down' | 'none', url?, devScript?, onRunDev }) in src/components/WebPreview/PreviewEmptyState.tsx.
// The outline on the page itself lives in the page (BACKEND, closed shadow root) and is the e2e run's.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Event = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
function mockPreview() {
  const listeners: Array<(event: Event) => void> = []
  const browserPreview = {
    onEvent: vi.fn((listener: (event: Event) => void) => { listeners.push(listener); return () => undefined }),
    revokeGrant: vi.fn(async () => undefined)
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, browserPreview } })
  const emit = (event: Event) => act(() => { for (const listener of listeners) listener({ ownerKey: 'code:ws-1', tabId: 'tab-1', ...event }) })
  return { browserPreview, emit }
}
async function renderChrome() {
  const { AgentBrowserChrome } = await load<{ AgentBrowserChrome: (props: { ownerKey: string; tabId: string; agentName: string }) => JSX.Element }>('src/components/WebPreview/AgentBrowserChrome')
  const { Toaster } = await import('../../../src/ui/Toast')
  render(<><AgentBrowserChrome ownerKey="code:ws-1" tabId="tab-1" agentName="Claude" /><Toaster /></>)
}
const grant = (origin: string, scope: string) => ({ type: 'grant', grant: { previewSessionId: 'ps-1', origin, scope, grantedAt: 1 } })
const action = (id: string, kind: string, label: string, extra: Event = {}) => ({ type: 'agent-action', phase: 'after', action: { id, kind, label, at: 1, ...extra }, result: 'ok' })

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('U5.1 · the agent browser', () => {
  test('the agent strip shows only while an agent may use the page, with "This session" on localhost and "Asks each time" elsewhere', async () => {
    const { emit } = mockPreview()
    await renderChrome()
    expect(screen.queryByText(/is using this page/)).toBeNull()
    emit(grant('http://localhost:3002', 'session'))
    expect(await screen.findByText(/Claude.*is using this page/)).toBeInTheDocument()
    expect(screen.getByText('This session')).toBeInTheDocument()
    emit(grant('https://example.org', 'action'))
    const chip = await screen.findByText('Asks each time')
    expect(chip.closest('[data-tone]')?.getAttribute('data-tone')).toBe('attn')
    emit({ type: 'grant', grant: null })
    await waitFor(() => expect(screen.queryByText(/is using this page/)).toBeNull())
  })

  test('End asks main to revoke the grant at once and says the agent can no longer use the page', async () => {
    const { emit, browserPreview } = mockPreview()
    await renderChrome()
    emit(grant('http://localhost:3002', 'session'))
    await userEvent.click(await screen.findByRole('button', { name: 'End' }))
    expect(browserPreview.revokeGrant).toHaveBeenCalledWith({ ownerKey: 'code:ws-1', tabId: 'tab-1' })
    expect(await screen.findByText('Claude can no longer use this page')).toBeInTheDocument()
  })

  test('the step strip lists what the agent did, oldest first, masks a password fill, and marks the current step', async () => {
    const { emit } = mockPreview()
    await renderChrome()
    emit(grant('http://localhost:3002', 'session'))
    emit(action('a1', 'navigate', '/statements'))
    emit(action('a2', 'fill', 'Month', { value: 'March' }))
    emit(action('a3', 'fill', 'Password', { value: '••••' }))
    emit({ type: 'agent-action', phase: 'before', action: { id: 'a4', kind: 'click', label: 'Download CSV', at: 2 } })
    const strip = await screen.findByRole('list', { name: 'What the agent did' })
    const steps = within(strip).getAllByRole('listitem').map(item => item.textContent?.trim())
    expect(steps).toEqual(['Opened /statements', 'Month: March', 'Password: ••••', 'Clicked Download CSV'])
    expect(within(strip).getAllByRole('listitem').at(-1)).toHaveAttribute('aria-current', 'step')
  })

  test('the Console chip counts errors and opens a drawer of masked rows; empty says nothing is logged', async () => {
    const { emit } = mockPreview()
    await renderChrome()
    const consoleChip = screen.getByRole('button', { name: /^Console/ })
    expect(consoleChip).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(consoleChip)
    expect(await screen.findByText('Nothing logged yet.')).toBeInTheDocument()
    emit({ type: 'console', row: { level: 'error', message: 'Failed to load token=•••', source: 'app.js', line: 42 }, at: 1 })
    emit({ type: 'console', row: { level: 'warning', message: 'Deprecated API', source: 'app.js', line: 7 }, at: 2 })
    expect(await screen.findByText(/Failed to load token=•••/)).toBeInTheDocument()
    expect(screen.getByText(/app\.js:42/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Console/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Console/ }).textContent).toMatch(/1/)
  })

  test('the Network drawer shows method, masked URL, status, type and time, and never a query value, header or body', async () => {
    const { emit } = mockPreview()
    await renderChrome()
    await userEvent.click(screen.getByRole('button', { name: /^Network/ }))
    emit({ type: 'network', row: { method: 'GET', url: 'http://localhost:3002/api/statements?month=•••&token=•••', status: 200, type: 'fetch', ms: 84 }, at: 1 })
    expect(await screen.findByText(/token=•••/)).toBeInTheDocument()
    expect(screen.getByText('GET')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/token=abc|Authorization|Cookie/)
  })

  test('the empty states: a dev server that is down offers to run it, and no page asks for an address', async () => {
    const { PreviewEmptyState } = await load<{ PreviewEmptyState: (props: { kind: 'down' | 'none'; url?: string; devScript?: string; onRunDev?: () => void }) => JSX.Element }>('src/components/WebPreview/PreviewEmptyState')
    const onRunDev = vi.fn()
    render(<PreviewEmptyState kind="down" url="localhost:3002" devScript="npm run dev" onRunDev={onRunDev} />)
    expect(screen.getByText("localhost:3002 isn't answering")).toBeInTheDocument()
    expect(screen.getByText('Start the dev server, then reload.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Run npm run dev' }))
    expect(onRunDev).toHaveBeenCalled()
    cleanup()
    render(<PreviewEmptyState kind="none" />)
    expect(screen.getByText('No page open')).toBeInTheDocument()
    expect(screen.getByText('Type an address, or run your dev server.')).toBeInTheDocument()
  })

  test('the strip and the steps read in pt-BR', async () => {
    await changeLanguage('pt-BR')
    const { emit } = mockPreview()
    await renderChrome()
    emit(grant('http://localhost:3002', 'session'))
    emit(action('a1', 'click', 'Download CSV'))
    expect(await screen.findByText(/Claude.*está usando esta página/)).toBeInTheDocument()
    expect(screen.getByText('Esta sessão')).toBeInTheDocument()
    expect(screen.getByText('Clicou em Download CSV')).toBeInTheDocument()
  })

  test("with the browser's DevTools open, the panel says the agent can't capture until they close", async () => {
    const { emit } = mockPreview()
    await renderChrome()
    emit({ type: 'broker', attached: true, devToolsOpen: true })
    expect(await screen.findByText("Close the browser's DevTools to let the agent capture.")).toBeInTheDocument()
    emit({ type: 'broker', attached: true, devToolsOpen: false })
    await waitFor(() => expect(screen.queryByText("Close the browser's DevTools to let the agent capture.")).toBeNull())
  })


  const previewRequest = (preview: Record<string, unknown>) => ({
    id: 'req-1', nativeId: 'n-1', nativeMethod: 'preview:authorize', kind: 'approval', title: 'Use the browser', generation: 1, createdAt: 1,
    state: 'pending', availableDecisions: ['accept', 'decline'], preview
  })
  async function renderCard(preview: Record<string, unknown>) {
    const { ThreadRequestCard } = await import('../../../src/components/Threads/ThreadRequestCard')
    const onRespond = vi.fn(async () => undefined)
    render(<ThreadRequestCard request={previewRequest(preview) as never} disabled={false} onRespond={onRespond} conversationId="t-1" />)
    return onRespond
  }

  test('a localhost preview approval names the action and covers this preview session, with Deny first', async () => {
    await renderCard({ origin: 'http://localhost:3002', scope: 'session', action: { kind: 'click', label: 'Download CSV' } })
    expect(await screen.findByText(/wants to use the browser/)).toBeInTheDocument()
    expect(screen.getByText('Click "Download CSV" on http://localhost:3002')).toBeInTheDocument()
    expect(screen.getByText('Allows this preview session on http://localhost:3002, until you end it.')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button').filter(button => /Deny|Allow/.test(button.textContent ?? ''))
    expect(buttons.map(button => button.textContent?.trim())).toEqual(['Deny', 'Allow for this session'])
  }, 30_000)

  test('any other origin allows only this action, a fill names its field and never its value, and leaving localhost says it always asks', async () => {
    await renderCard({ origin: 'https://example.org', scope: 'action', action: { kind: 'fill', label: 'Password' } })
    expect(await screen.findByText('Fill "Password" on https://example.org')).toBeInTheDocument()
    expect(screen.getByText('Allows only this action.')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button').filter(button => /Deny|Allow/.test(button.textContent ?? ''))
    expect(buttons.map(button => button.textContent?.trim())).toEqual(['Deny', 'Allow once'])
    expect(document.body.textContent).not.toMatch(/hunter2|••••/)
    cleanup()
    await renderCard({ origin: 'http://localhost:3002', scope: 'action', action: { kind: 'navigate', label: 'Pay', target: 'https://pay.example.com/checkout' } })
    expect(await screen.findByText('Open https://pay.example.com/checkout')).toBeInTheDocument()
    expect(screen.getByText('Leaving localhost always asks.')).toBeInTheDocument()
  }, 30_000)

  test('the preview approval card reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    await renderCard({ origin: 'http://localhost:3002', scope: 'session', action: { kind: 'scroll', label: '' } })
    expect(await screen.findByText(/quer usar o navegador/)).toBeInTheDocument()
    expect(screen.getByText('Rolar em http://localhost:3002')).toBeInTheDocument()
    expect(screen.getByText('Libera esta sessão de prévia em http://localhost:3002, até você encerrar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Permitir nesta sessão' })).toBeInTheDocument()
  }, 30_000)

})
