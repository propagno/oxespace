// OXE-175: a new approval request never takes the focus from someone typing. Before the fix the toast and the
// request card moved the focus onto Deny on every new request, so the next Space typed denied another agent's request.
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalToast } from '../src/components/Approvals/ApprovalToast'
import { focusIsEditable } from '../src/components/Approvals/typingFocus'
import { ThreadRequestCard } from '../src/components/Threads/ThreadRequestCard'
import { changeLanguage } from '../src/i18n'
import type { ThreadRequest, ThreadRequestImpact } from '../shared/types/thread'

const REVERSIBLE: ThreadRequestImpact = { why: 'Runs the unit tests.', where: 'shop', affects: { count: 2, unit: 'files' }, reversible: true, undoHow: 'checkpoint', risk: 'low', kind: 'file', text: 'apply_patch src/a.ts', lang: 'diff' }
const request = (id: string, extra: Partial<ThreadRequest> = { impact: REVERSIBLE }): ThreadRequest => ({
  id, nativeId: `n-${id}`, nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Edit a file', toolName: 'Bash', command: 'apply_patch src/a.ts',
  generation: 1, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'decline'], ...extra
})

/** Something outside the approval surfaces that holds the focus before the request arrives. */
function focusOutside(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  const target = host.querySelector<HTMLElement>('[data-target]')!
  target.focus()
  expect(target).toHaveFocus()
  return target
}

function renderToast(id = 'r1') {
  const props = { agent: 'Claude', onRespond: vi.fn(async () => undefined), onSeeImpact: vi.fn(), onClose: vi.fn() }
  const view = render(<ApprovalToast request={request(id)} {...props} />)
  return { ...props, rerender: (next: string) => view.rerender(<ApprovalToast request={request(next)} {...props} />) }
}

afterEach(async () => {
  cleanup()
  document.body.innerHTML = ''
  await changeLanguage('en')
})

describe('OXE-175 · which focus counts as typing', () => {
  it('a textarea, an input that is not read-only, contenteditable and the xterm helper textarea are editable', () => {
    const host = document.createElement('div')
    host.innerHTML = '<textarea id="a"></textarea><input id="b"><input id="c" readonly><div id="d" contenteditable="true"><span id="e">x</span></div><div id="f" contenteditable="false"></div><button id="g">B</button><textarea id="h" class="xterm-helper-textarea"></textarea>'
    document.body.append(host)
    const at = (id: string) => host.querySelector(`#${id}`)
    expect(focusIsEditable(at('a'))).toBe(true)
    expect(focusIsEditable(at('b'))).toBe(true)
    expect(focusIsEditable(at('c'))).toBe(false)
    expect(focusIsEditable(at('d'))).toBe(true)
    expect(focusIsEditable(at('e'))).toBe(true)
    expect(focusIsEditable(at('f'))).toBe(false)
    expect(focusIsEditable(at('g'))).toBe(false)
    expect(focusIsEditable(at('h'))).toBe(true)
    expect(focusIsEditable(document.body)).toBe(false)
    expect(focusIsEditable(null)).toBe(false)
  })
})

describe('OXE-175 · the toast', () => {
  it('a focused textarea keeps the focus; the toast is announced politely and a typed Space denies nothing', async () => {
    const composer = focusOutside('<textarea data-target aria-label="Message"></textarea>')
    const toast = renderToast()
    const status = screen.getByText('Needs you: Edit a file · Claude')
    expect(status.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite')
    expect(composer).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(toast.onRespond).not.toHaveBeenCalled()
    expect(composer).toHaveValue(' ')
  })

  it('the terminal (xterm helper textarea) keeps the focus, also when a second request arrives', async () => {
    const terminal = focusOutside('<div class="xterm"><textarea data-target class="xterm-helper-textarea" aria-label="Terminal input"></textarea></div>')
    const toast = renderToast('r1')
    expect(terminal).toHaveFocus()
    act(() => toast.rerender('r2'))
    expect(terminal).toHaveFocus()
    await userEvent.keyboard(' {Enter}')
    expect(toast.onRespond).not.toHaveBeenCalled()
  })

  it('a contenteditable editor keeps the focus', () => {
    const editor = focusOutside('<div data-target contenteditable="true" tabindex="0">notes</div>')
    renderToast()
    expect(editor).toHaveFocus()
  })

  it('in pt-BR the announcement names the agent and says "Precisa de você"', async () => {
    await changeLanguage('pt-BR')
    const composer = focusOutside('<textarea data-target></textarea>')
    renderToast()
    expect(screen.getByText('Precisa de você: Edit a file · Claude').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
    expect(composer).toHaveFocus()
  })

  it('focus on a button or a read-only field still moves to Deny, as today', () => {
    focusOutside('<button data-target>Somewhere</button>')
    renderToast()
    expect(screen.getByRole('button', { name: /^Deny/ })).toHaveFocus()
    cleanup()
    document.body.innerHTML = ''
    focusOutside('<input data-target readonly value="path">')
    renderToast()
    expect(screen.getByRole('button', { name: /^Deny/ })).toHaveFocus()
  })
})

describe('OXE-175 · the request card while the composer is focused', () => {
  const composerHtml = '<form class="thread-composer"><textarea data-target data-thread-composer="true" aria-label="Message"></textarea></form>'

  it('an impact card leaves the focus in the composer, and a typed Space answers nothing', async () => {
    const composer = focusOutside(composerHtml)
    const onRespond = vi.fn(async () => undefined)
    const view = render(<ThreadRequestCard request={request('r1')} agent="Claude" disabled={false} onRespond={onRespond} conversationId="t-1" />)
    expect(await screen.findByText('Claude needs your approval')).toBeInTheDocument()
    expect(composer).toHaveFocus()
    view.rerender(<ThreadRequestCard request={request('r2')} agent="Claude" disabled={false} onRespond={onRespond} conversationId="t-1" />)
    expect(composer).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(onRespond).not.toHaveBeenCalled()
    expect(composer).toHaveValue(' ')
  })

  it('a browser-preview card leaves the focus in the composer', () => {
    const composer = focusOutside(composerHtml)
    render(<ThreadRequestCard request={request('p1', { impact: undefined, preview: { origin: 'http://localhost:5173', scope: 'action', agentName: 'Claude', action: { kind: 'click', label: 'Buy' } } })} disabled={false} onRespond={vi.fn(async () => undefined)} conversationId="t-1" />)
    expect(screen.getByRole('button', { name: /Deny/ })).toBeInTheDocument()
    expect(composer).toHaveFocus()
  })

  it('with nothing being typed the impact card still focuses Deny', async () => {
    render(<ThreadRequestCard request={request('r1')} agent="Claude" disabled={false} onRespond={vi.fn(async () => undefined)} conversationId="t-1" />)
    expect(await screen.findByRole('button', { name: /^Deny/ })).toHaveFocus()
  })
})
