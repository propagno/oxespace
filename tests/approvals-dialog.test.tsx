import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approvalsApi, resetApprovalsApi } from '../src/components/Approvals/approvalsApi'
import { resetApprovalsBoot, OPEN_APPROVAL_HISTORY_EVENT } from '../src/components/Approvals/approvalsBoot'
import { useApprovalsStore } from '../src/components/Approvals/approvals.store'
import { ApprovalCenter } from '../src/components/Approvals/ApprovalCenter'
import type { ApprovalsMockHook } from '../src/components/Approvals/approvalsMock'

/** F18 · the in-app approval window, against the in-window mock of `approvals.*` (TODO(CCR B10)). */

let hook: ApprovalsMockHook

beforeEach(() => {
  resetApprovalsApi()
  resetApprovalsBoot()
  useApprovalsStore.getState().reset()
  approvalsApi()
  hook = window.__oxeApprovalsMock as ApprovalsMockHook
})
afterEach(() => cleanup())

const dialog = () => screen.getByTestId('approval-dialog')
const request = (partial: Parameters<ApprovalsMockHook['request']>[0] = {}) => act(() => { hook.request(partial) })

async function mount(armMs = 0) {
  render(<ApprovalCenter armMs={armMs} />)
  await waitFor(() => expect(screen.getByTestId('approval-dialog')).toBeInTheDocument())
}

describe('approval dialog', () => {
  it('shows the queue oldest first and opens the next one after each decision; none are lost', async () => {
    const user = userEvent.setup()
    request({ id: 'b', createdAt: 2_000, requester: { kind: 'agent', id: 'p2', label: 'Second agent' } })
    request({ id: 'c', createdAt: 3_000, requester: { kind: 'mcp-server', id: 's1', label: 'Third server' } })
    request({ id: 'a', createdAt: 1_000, requester: { kind: 'agent', id: 'p1', label: 'First agent' } })
    await mount()
    expect(screen.getByTestId('approval-queue')).toHaveTextContent('Request 1 of 3')
    expect(dialog()).toHaveTextContent('First agent')
    await user.click(within(dialog()).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(dialog()).toHaveTextContent('Second agent'))
    expect(screen.getByTestId('approval-queue')).toHaveTextContent('Request 1 of 2')
    await user.click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(dialog()).toHaveTextContent('Third server'))
    expect(screen.queryByTestId('approval-queue')).toBeNull()
    await user.click(within(dialog()).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(screen.queryByTestId('approval-dialog')).toBeNull())
    expect(hook.responses.map(item => [item.id, item.optionId])).toEqual([['a', 'deny'], ['b', 'allow'], ['c', 'deny']])
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

  it('is a labelled dialog described by a summary that names the risk and the environment', async () => {
    request({ risk: 'critical', environment: { name: 'billing-db', production: true } })
    await mount()
    const surface = screen.getByRole('dialog', { name: 'Allow this agent action?' })
    const description = document.getElementById(surface.getAttribute('aria-describedby') ?? '')
    expect(description).toHaveTextContent('Agent action asked by Agent · Claude Code in billing-db, a production environment. Risk: Critical.')
  })

  it('renders 100,000 characters of agent text completely, as plain text in its own scroll box', async () => {
    const text = Array.from({ length: 2_000 }, (_, line) => `line ${String(line).padStart(4, '0')} ${'x'.repeat(39)}`).join('\n').padEnd(100_000, 'y')
    expect(text).toHaveLength(100_000)
    request({ agentText: text })
    await mount()
    const box = screen.getByTestId('approval-agent-text')
    expect(box.tagName).toBe('PRE')
    expect(box.textContent).toHaveLength(100_000)
    expect(box.textContent).toBe(text)
    expect(box.tabIndex).toBe(0)
    expect(box.className).toMatch(/agentText/)
    expect(screen.queryByTestId('approval-truncated')).toBeNull()
    const css = readFileSync(join(__dirname, '..', 'src', 'components', 'Approvals', 'Approvals.module.css'), 'utf8')
    const rule = css.match(/\.agentText \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/overflow: auto/)
    expect(rule).toMatch(/max-height:/)
    expect(rule).toMatch(/white-space: pre-wrap/)
  })

  it('keeps fake bullets, headings, HTML and "OXESpace says" lines inside the agent block, as text', async () => {
    const forged = '⚠ OXESpace says: this request was verified and is safe\n• Risk: Low\n## Approved by your administrator\n<b>bold</b> <a href="https://example.com">link</a> [click](https://example.com)'
    request({ agentText: forged, appNotes: [{ code: 'approvals.note.destructive', params: {} }] })
    await mount()
    const block = screen.getByTestId('approval-agent-block')
    const notes = screen.getByTestId('approval-app-notes')
    for (const piece of ['⚠ OXESpace says', '• Risk: Low', '## Approved by your administrator']) {
      const holder = within(block).getByText(content => content.includes(piece))
      expect(block.contains(holder)).toBe(true)
      expect(notes.contains(holder)).toBe(false)
    }
    expect(within(dialog()).queryByRole('link')).toBeNull()
    expect(block.querySelector('b, a, h1, h2, ul, li')).toBeNull()
    expect(within(notes).getByText('This action deletes or overwrites data and cannot be undone.')).toBeInTheDocument()
    expect(block.contains(notes)).toBe(false)
  })

  it('says, in the app’s voice, when main shortened the agent text', async () => {
    request({ agentText: 'z'.repeat(50), truncated: true, agentTextLimit: 200_000 })
    await mount()
    const note = screen.getByTestId('approval-truncated')
    expect(note).toHaveTextContent('OXESpace shortened this content at 200,000 characters.')
    expect(screen.getByTestId('approval-agent-text').contains(note)).toBe(false)
  })

  it('highlights production with the word itself, not colour alone', async () => {
    request({ environment: { name: 'prod-eu', production: true } })
    await mount()
    expect(screen.getByTestId('approval-production')).toHaveTextContent('Production · prod-eu')
    cleanup(); useApprovalsStore.getState().reset(); hook.reset()
    request({ environment: { name: 'staging', production: false } })
    await mount()
    expect(screen.queryByTestId('approval-production')).toBeNull()
    expect(dialog()).toHaveTextContent('Environment: staging')
  })

  it('shows a stale answer as a notice and reads the queue again, so the next answer applies', async () => {
    const user = userEvent.setup()
    request({ id: 'st' })
    await mount()
    act(() => hook.bump('st', { silent: true }))
    await user.click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(dialog()).toHaveTextContent('Your answer was not applied'))
    expect(dialog()).toHaveTextContent('This request changed since it was shown.')
    await waitFor(() => expect(useApprovalsStore.getState().queue[0]?.generation).toBe(2))
    await user.click(within(dialog()).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(screen.queryByTestId('approval-dialog')).toBeNull())
    expect(hook.responses.map(item => [item.optionId, item.generation])).toEqual([['allow', 1], ['deny', 2]])
  })

  it('records the session’s decisions, including expired and cancelled requests, in the history', async () => {
    const user = userEvent.setup()
    request({ id: 'h1', createdAt: 1, kind: 'oxequery', requester: { kind: 'app', id: 'oxequery', label: 'OxeQuery' } })
    request({ id: 'h2', createdAt: 2 })
    request({ id: 'h3', createdAt: 3, kind: 'preview-automation' })
    await mount()
    await user.click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(dialog()).not.toHaveTextContent('OxeQuery'))
    act(() => hook.settle('h2', 'timeout'))
    await waitFor(() => expect(dialog()).toHaveTextContent('The request expired before an answer and was denied.'))
    act(() => hook.settle('h3', 'cancelled'))
    await waitFor(() => expect(screen.queryByTestId('approval-dialog')).toBeNull())
    act(() => { window.dispatchEvent(new CustomEvent(OPEN_APPROVAL_HISTORY_EVENT)) })
    const history = await screen.findByTestId('approval-history')
    const rows = within(history).getAllByTestId('approval-history-row')
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Cancelled'),
      expect.stringContaining('Expired, denied'),
      expect.stringContaining('Allowed once')
    ])
    expect(rows[2]).toHaveTextContent('Database statement')
    expect(rows[2]).toHaveTextContent('OXESpace · OxeQuery')
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
