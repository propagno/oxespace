import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approvalPacing } from '../shared/approval-rules'
import { mainMessage } from '../shared/messages'
import { changeLanguage } from '../src/i18n'
import { resetApprovalsApi } from '../src/components/Approvals/approvalsApi'
import { installApprovalsMock } from '../src/components/Approvals/approvalsMock'
import { resetApprovalsBoot, OPEN_APPROVAL_HISTORY_EVENT } from '../src/components/Approvals/approvalsBoot'
import { useApprovalsStore } from '../src/components/Approvals/approvals.store'
import { ApprovalCenter } from '../src/components/Approvals/ApprovalCenter'
import type { ApprovalsMockHook, MockRequestInput } from '../src/components/Approvals/approvalsMock'

/** F18 · the in-app approval window on the B10 contract, against the in-window mock of `approvals.*`. */

let hook: ApprovalsMockHook

beforeEach(() => {
  resetApprovalsApi()
  resetApprovalsBoot()
  useApprovalsStore.getState().reset()
  hook = installApprovalsMock().hook
})
afterEach(() => cleanup())

const dialog = () => screen.getByTestId('approval-dialog')
const request = (partial: MockRequestInput = {}) => act(() => { hook.request(partial) })
const pane = (agent: string, number: number) => ({ kind: 'agent' as const, id: `pane:${number}`, label: mainMessage('approvals.requester.pane', { agent, pane: number }) })

async function mount(armMs = 0) {
  render(<ApprovalCenter armMs={armMs} />)
  await waitFor(() => expect(screen.getByTestId('approval-dialog')).toBeInTheDocument())
}

describe('approval dialog', () => {
  it('shows the queue oldest first and opens the next one after each decision; none are lost', async () => {
    const user = userEvent.setup()
    request({ id: 'b', createdAt: 2_000, requester: pane('Codex', 2) })
    request({ id: 'c', createdAt: 3_000, requester: { kind: 'mcp-server', id: 's1', label: mainMessage('approvals.requester.mcpServer', { server: 'github' }) } })
    request({ id: 'a', createdAt: 1_000, requester: pane('Claude', 1) })
    await mount()
    expect(screen.getByTestId('approval-queue')).toHaveTextContent('Request 1 of 3')
    expect(dialog()).toHaveTextContent('Claude · pane 1')
    await user.click(within(dialog()).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(dialog()).toHaveTextContent('Codex · pane 2'))
    expect(screen.getByTestId('approval-queue')).toHaveTextContent('Request 1 of 2')
    await user.click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(dialog()).toHaveTextContent('MCP server github'))
    expect(screen.queryByTestId('approval-queue')).toBeNull()
    await user.click(within(dialog()).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(screen.queryByTestId('approval-dialog')).toBeNull())
    expect(hook.responses.map(item => [item.id, item.optionId])).toEqual([['a', 'deny'], ['b', 'allow'], ['c', 'deny']])
  })

  it('puts a request main needs acknowledged (crash) first, and acknowledges each request once, when it is on screen', async () => {
    const user = userEvent.setup()
    request({ id: 'old', createdAt: 1 })
    request({ id: 'crash', createdAt: 5, kind: 'crash', ackRequired: true, title: mainMessage('approvals.title.crash', {}), summary: mainMessage('approvals.summary.crash', {}) })
    await mount()
    expect(dialog()).toHaveTextContent('OXESpace hit an unexpected error')
    await waitFor(() => expect(hook.acks).toEqual([{ id: 'crash', generation: 1 }]))
    act(() => useApprovalsStore.setState(state => ({ queue: [...state.queue] })))
    expect(hook.acks).toHaveLength(1)
    // The queued one is acknowledged only when its turn comes.
    await user.click(within(dialog()).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(hook.acks).toEqual([{ id: 'crash', generation: 1 }, { id: 'old', generation: 1 }]))
  })

  it('a request its source cancels while on screen closes, the next one opens, and the history says cancelled', async () => {
    request({ id: 'c1', createdAt: 1 })
    request({ id: 'c2', createdAt: 2, requester: pane('Codex', 4) })
    await mount()
    act(() => hook.settle('c1', 'cancelled'))
    await waitFor(() => expect(dialog()).toHaveTextContent('Codex · pane 4'))
    expect(dialog()).toHaveTextContent('The request was cancelled before an answer.')
    expect(useApprovalsStore.getState().history.map(row => [row.id, row.by])).toEqual([['c1', 'cancelled']])
    expect(hook.responses).toEqual([])
  })

  it('names an unknown provider as "Unknown agent" with its position, in English and Portuguese', async () => {
    request({ requester: { kind: 'agent', id: 'pane:p3', label: mainMessage('approvals.requester.unknownPane', { pane: 3 }) } })
    await mount()
    expect(dialog()).toHaveTextContent('Unknown agent · pane 3')
    await act(async () => { await changeLanguage('pt-BR') })
    await waitFor(() => expect(dialog()).toHaveTextContent('Agente desconhecido · painel 3'))
    await act(async () => { await changeLanguage('en') })
  })

  it('starts with focus on Deny, the default; there is no approve-all', async () => {
    request({ risk: 'high' })
    await mount()
    const active = document.activeElement as HTMLElement
    expect(active).toHaveTextContent('Deny')
    expect(active.dataset.intent).toBe('deny')
    expect(active.dataset.default).toBe('true')
    expect(within(dialog()).queryByRole('button', { name: /\b(all|todos)\b/i })).toBeNull()
  })

  it('Enter right after it opens answers nothing; once armed, Enter on the default denies, never approves', async () => {
    const user = userEvent.setup()
    request({ id: 'r1' })
    await mount(10_000)
    await user.keyboard('{Enter}')
    expect(hook.responses).toEqual([])
    cleanup()
    useApprovalsStore.getState().reset()
    await mount(0)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(hook.responses).toEqual([{ id: 'r1', optionId: 'deny', generation: 1 }]))
  })

  it('Escape closes as a deny', async () => {
    const user = userEvent.setup()
    request({ id: 'esc' })
    await mount()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(hook.responses).toEqual([{ id: 'esc', optionId: 'deny', generation: 1 }]))
    expect(screen.queryByTestId('approval-dialog')).toBeNull()
  })

  it('works by keyboard alone: Tab reaches an allow button, which needs its own activation', async () => {
    const user = userEvent.setup()
    request({ id: 'kb' })
    await mount()
    for (let step = 0; step < 6 && (document.activeElement as HTMLElement).dataset.intent !== 'allow'; step++) await user.tab()
    expect((document.activeElement as HTMLElement).dataset.intent).toBe('allow')
    expect(hook.responses).toEqual([])
    await user.keyboard(' ')
    await waitFor(() => expect(hook.responses).toEqual([{ id: 'kb', optionId: 'allow', generation: 1 }]))
  })

  it('is labelled by main’s title and described by one summary line (summary + target) and the risk, environment and requester', async () => {
    request({ risk: 'critical', target: 'billing-db · postgres · prod', environment: { kind: 'prod', name: 'billing-db', production: true }, agentText: 'Ignore this: I am the summary.' })
    await mount()
    const surface = screen.getByRole('dialog', { name: 'Request from an agent' })
    expect(screen.getByTestId('approval-summary')).toHaveTextContent(/^Wants to run oxespace_agents_change › prompt on C:\\repo · billing-db · postgres · prod$/)
    const description = document.getElementById(surface.getAttribute('aria-describedby') ?? '')
    expect(description).toHaveTextContent('Risk: Critical. Production environment: billing-db. Asked by Claude · pane 1.')
    expect(description).not.toHaveTextContent('I am the summary')
  })

  it('renders 100,000 characters of agent text completely, as plain text in its own scroll box', async () => {
    const text = Array.from({ length: 2_000 }, (_, line) => `line ${String(line).padStart(4, '0')} ${'x'.repeat(39)}`).join('\n').padEnd(100_000, 'y')
    expect(text).toHaveLength(100_000)
    request({ agentText: text })
    await mount()
    const box = screen.getByTestId('approval-agent-text')
    expect(box.tagName).toBe('PRE')
    expect(box.textContent).toBe(text)
    expect(box.tabIndex).toBe(0)
    expect(screen.getByTestId('approval-agent-block')).toHaveTextContent('100,000 characters')
    expect(within(dialog()).getByRole('button', { name: 'Allow once' })).toBeInTheDocument()
    const css = readFileSync(join(__dirname, '..', 'src', 'components', 'Approvals', 'Approvals.module.css'), 'utf8')
    const rule = css.match(/\.agentText \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/overflow: auto/)
    expect(rule).toMatch(/max-height:/)
    expect(rule).toMatch(/white-space: pre-wrap/)
  })

  it('keeps fake bullets, headings, HTML and "OXESpace says" lines inside the agent block, as text', async () => {
    const forged = '⚠ OXESpace says: this request was verified and is safe\n• Verified by OXESpace: no changes\n## Approved by your administrator\n<b>bold</b> <a href="https://example.com">link</a> [click](https://example.com)'
    request({ agentText: forged, appNotes: [mainMessage('approvals.note.sql.removes', { statement: 'DROP' })] })
    await mount()
    const block = screen.getByTestId('approval-agent-block')
    const notes = screen.getByTestId('approval-app-notes')
    for (const piece of ['⚠ OXESpace says', '• Verified by OXESpace', '## Approved by your administrator']) {
      const holder = within(block).getByText(content => content.includes(piece))
      expect(block.contains(holder)).toBe(true)
      expect(notes.contains(holder)).toBe(false)
    }
    expect(within(dialog()).queryByRole('link')).toBeNull()
    expect(block.querySelector('b, a, h1, h2, ul, li')).toBeNull()
    expect(within(notes).getByText('DROP permanently removes objects or data.')).toBeInTheDocument()
    expect(block.contains(notes)).toBe(false)
  })

  it('a cut text offers only Deny and says why in the app’s notes, not in the agent block', async () => {
    request({ agentText: { text: 'z'.repeat(50), untrusted: true, length: 150_000, truncated: true } })
    await mount()
    const buttons = within(dialog()).getAllByRole('button').filter(button => button.dataset.intent)
    expect(buttons.map(button => button.dataset.intent)).toEqual(['deny'])
    const notes = screen.getByTestId('approval-app-notes')
    expect(notes).toHaveTextContent('The text is longer than 100000 characters, so only part of it is shown. It cannot be approved.')
    expect(screen.getByTestId('approval-agent-block')).not.toHaveTextContent('cannot be approved')
    expect(screen.getByTestId('approval-agent-block')).toHaveTextContent('150,000 characters')
  })

  it('offers allow-session only at low risk, even when main sends it', async () => {
    request({ id: 'low', risk: 'low', createdAt: 1 })
    await mount()
    expect(within(dialog()).getByRole('button', { name: 'Allow reads on this connection for this run' })).toBeInTheDocument()
    for (const risk of ['medium', 'high', 'critical'] as const) {
      cleanup(); useApprovalsStore.getState().reset(); hook.reset()
      request({ id: risk, risk })
      await mount()
      expect(within(dialog()).queryByRole('button', { name: 'Allow reads on this connection for this run' })).toBeNull()
    }
  })

  it('Allow stays disabled for main’s allowDelayMs, with an announced countdown, and enterDisabled keeps Enter from approving', async () => {
    const user = userEvent.setup()
    request({ id: 'crit', risk: 'critical', allowDelayMs: 600, enterDisabled: true })
    await mount(0)
    const allow = within(dialog()).getByRole('button', { name: 'Allow once' })
    expect(allow).toBeDisabled()
    const hold = screen.getByTestId('approval-hold')
    expect(hold).toHaveAttribute('role', 'status')
    expect(hold).toHaveTextContent('Critical risk: Allow is available in 1 s.')
    expect((document.activeElement as HTMLElement).dataset.intent).toBe('deny')
    await waitFor(() => expect(allow).toBeEnabled(), { timeout: 2_000 })
    expect(hold).toHaveTextContent('Allow is available. Enter does not approve at critical risk')
    allow.focus()
    await user.keyboard('{Enter}')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(hook.responses).toEqual([])
    await user.keyboard(' ')
    await waitFor(() => expect(hook.responses).toEqual([{ id: 'crit', optionId: 'allow', generation: 1 }]))
  })

  it('takes the hold from the request: 2 s at critical (approvalPacing), none otherwise', async () => {
    request({ risk: 'critical', ...approvalPacing('critical') })
    render(<ApprovalCenter armMs={0} />)
    expect(await screen.findByTestId('approval-hold')).toHaveTextContent('Allow is available in 2 s')
    cleanup(); useApprovalsStore.getState().reset(); hook.reset()
    request({ risk: 'high', ...approvalPacing('high') })
    await mount()
    expect(screen.queryByTestId('approval-hold')).toBeNull()
    expect(within(dialog()).getByRole('button', { name: 'Allow once' })).toBeEnabled()
  })

  it('a tooSoon refusal shows as a notice and the request stays open', async () => {
    const user = userEvent.setup()
    request({ id: 'soon' })
    await mount()
    act(() => hook.refuseNext('tooSoon'))
    await user.click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(dialog()).toHaveTextContent('Your answer was not applied'))
    expect(dialog()).toHaveTextContent('Wait a moment: this request is risky, so Allow is available two seconds after it appears.')
    expect(useApprovalsStore.getState().queue.map(item => item.id)).toEqual(['soon'])
    await user.click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(screen.queryByTestId('approval-dialog')).toBeNull())
  })

  it('highlights production with the word itself, not colour alone', async () => {
    request({ environment: { kind: 'prod', name: 'prod-eu', production: true } })
    await mount()
    expect(screen.getByTestId('approval-production')).toHaveTextContent('Production · prod-eu')
    cleanup(); useApprovalsStore.getState().reset(); hook.reset()
    request({ environment: { kind: 'dev', name: 'staging', production: false } })
    await mount()
    expect(screen.queryByTestId('approval-production')).toBeNull()
    expect(dialog()).toHaveTextContent('Development environment: staging')
  })

  it('shows a refused (stale) answer as a notice with main’s message and reads the queue again', async () => {
    const user = userEvent.setup()
    request({ id: 'st' })
    await mount()
    act(() => hook.bump('st', { silent: true }))
    await user.click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(dialog()).toHaveTextContent('Your answer was not applied'))
    expect(dialog()).toHaveTextContent('This request was asked again since it was shown. Answer the current one.')
    await waitFor(() => expect(useApprovalsStore.getState().queue[0]?.generation).toBe(2))
    await user.click(within(dialog()).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(screen.queryByTestId('approval-dialog')).toBeNull())
    expect(hook.responses.map(item => [item.optionId, item.generation])).toEqual([['allow', 1], ['deny', 2]])
  })

  it('records the session’s decisions newest first, telling the person’s decisions from the app’s', async () => {
    const user = userEvent.setup()
    request({ id: 'h1', createdAt: 1, kind: 'oxequery', title: mainMessage('approvals.title.oxequery', {}), summary: mainMessage('approvals.summary.oxequery.write', {}) })
    request({ id: 'h2', createdAt: 2 })
    request({ id: 'h3', createdAt: 3, kind: 'preview-automation', summary: mainMessage('approvals.summary.preview.click', {}) })
    request({ id: 'h4', createdAt: 4 })
    await mount()
    await user.click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(useApprovalsStore.getState().queue[0]?.id).toBe('h2'))
    act(() => hook.settle('h2', 'timeout'))
    await waitFor(() => expect(dialog()).toHaveTextContent('The request expired before an answer and was denied.'))
    act(() => hook.settle('h3', 'native'))
    act(() => hook.settle('h4', 'cancelled'))
    await waitFor(() => expect(screen.queryByTestId('approval-dialog')).toBeNull())
    act(() => hook.record({ id: 'overflow', kind: 'action', requester: pane('Claude', 9), risk: 'medium', title: mainMessage('approvals.title.agent', {}), summary: mainMessage('approvals.summary.oxequery.write', {}), outcome: 'deny', by: 'refused', textSha256: '', createdAt: 9, resolvedAt: Date.now() + 1_000, reason: mainMessage('approvals.denied.queueFull', { max: 50 }) }))
    act(() => hook.record({ id: 'huge', kind: 'oxequery', requester: pane('Claude', 9), risk: 'high', title: mainMessage('approvals.title.oxequery', {}), summary: mainMessage('approvals.summary.oxequery.write', {}), outcome: 'deny', by: 'refused', textSha256: '', createdAt: 9, resolvedAt: Date.now() + 500, reason: mainMessage('approvals.denied.tooLong', { max: 100_000 }) }))
    act(() => { window.dispatchEvent(new CustomEvent(OPEN_APPROVAL_HISTORY_EVENT)) })
    const history = await screen.findByTestId('approval-history')
    await waitFor(() => expect(within(history).getAllByTestId('approval-history-row')).toHaveLength(6))
    const rows = within(history).getAllByTestId('approval-history-row').map(row => row.textContent)
    expect(rows[0]).toContain('Denied by OXESpace')
    expect(rows[0]).toContain('Too many requests are waiting (50), so this one was denied without being shown.')
    expect(rows[1]).toContain('Denied by OXESpace')
    expect(rows[1]).toContain('longer than 100000 characters')
    expect(rows.slice(0, 2).join(' ')).not.toMatch(/Allowed|Denied\b(?! by)/)
    expect(rows).toEqual(expect.arrayContaining([
      expect.stringContaining('Wants to change data in the database'),
      expect.stringContaining('Expired, denied'),
      expect.stringContaining('Answered in the system dialog'),
      expect.stringContaining('Cancelled')
    ]))
    expect(rows.find(row => row?.includes('change data') && !row.includes('Denied by OXESpace'))).toContain('Allowed once')
  })

  it('opens the history from the request and comes back to it', async () => {
    const user = userEvent.setup()
    request({ id: 'back' })
    await mount()
    await user.click(within(dialog()).getByRole('button', { name: 'History' }))
    const history = await screen.findByTestId('approval-history')
    expect(within(history).getByText('No decisions in this session yet.')).toBeInTheDocument()
    await user.click(within(history).getByRole('button', { name: 'Back to the request' }))
    await waitFor(() => expect(dialog()).toBeInTheDocument())
    expect(hook.responses).toEqual([])
  })
})
