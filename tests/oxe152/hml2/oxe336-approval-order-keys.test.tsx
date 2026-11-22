// Frozen acceptance test for 1.5.2 HML fixes, pass 2 (Jira OXE-336; 152hml2). Written by the planner; the executor must
// not edit it. 8e's decision (21/11), from the design system: Deny is always the first action and the allow comes after it
// on every approval surface (the frozen u51, u71, u73 and main-dialogs orders; docs/design/mobile-conversation.md: Deny is
// the safe answer, never danger red). Each surface keeps its own emphasis rule (ApprovalDialog B10: the emphasis follows
// Enter; ImpactPreview u72: a reversible Approve is primary, a critical one is the 1.2 s hold). What HML found broken:
// - ImpactPreview shows the D and A key hints but has no key listener (src/components/Approvals/ImpactPreview.tsx).
// - ApprovalQueue's critical hold is a hand-made pointer button: no progress, no Space/Enter; it must be <HoldToApprove />.
// - ThreadRequestCard's plain approval (no impact) puts Approve first and Deny last, the reverse of the impact card.
// Contract: in ImpactPreview, outside a text field and without a modifier or a repeat, D denies; A approves a reversible
// request, and on a critical one it approves nothing by itself (the hold does). ApprovalQueue's critical request uses the
// shared HoldToApprove: holding Space on it 1.2 s approves. The plain approval card lists Deny before Approve.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Props = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const EDIT = { why: 'Fixes the total.', where: 'shop', affects: { count: 2, unit: 'files' }, reversible: true, undoHow: 'checkpoint', risk: 'low', kind: 'file', text: 'apply_patch src/a.ts', lang: 'diff' }
const PUSH = { why: 'Publishes the package.', where: 'shop', affects: { count: 1, unit: 'resources' }, reversible: false, risk: 'critical', kind: 'push', text: 'npm publish', lang: 'shell' }
const request = (id: string, impact?: Props) => ({
  id, nativeId: `n-${id}`, nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Run it', toolName: 'Bash', command: impact?.text ?? 'npm test',
  generation: 1, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'decline'], ...(impact ? { impact } : {})
})
const FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] as const

function mockPreview() {
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, approvals: { preview: vi.fn(async () => ({ status: 'ok', count: 1 })) } } })
}
async function renderPreview(impact: Props) {
  const { ImpactPreview } = await load<{ ImpactPreview: (props: Props) => JSX.Element }>('src/components/Approvals/ImpactPreview')
  const onRespond = vi.fn(async () => undefined)
  render(<ImpactPreview request={request('r1', impact)} agent="Claude" conversation="Checkout" onRespond={onRespond} onClose={vi.fn()} />)
  return onRespond
}

afterEach(async () => { cleanup(); vi.useRealTimers(); await changeLanguage('en') })

describe('OXE-336 · Deny first, and the keys the approval surfaces show', { timeout: 30_000 }, () => {
  test('in the impact preview D denies and A approves a reversible request; a repeat, a modifier or a text field does nothing', async () => {
    mockPreview()
    const onRespond = await renderPreview(EDIT)
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'a', repeat: true })
    fireEvent.keyDown(dialog, { key: 'a', ctrlKey: true })
    const field = document.createElement('input')
    dialog.appendChild(field)
    fireEvent.keyDown(field, { key: 'a' })
    expect(onRespond).not.toHaveBeenCalled()
    await act(async () => { fireEvent.keyDown(dialog, { key: 'a' }) })
    expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' })
    cleanup()
    const onDeny = await renderPreview(EDIT)
    await act(async () => { fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'd' }) })
    expect(onDeny).toHaveBeenCalledWith({ decision: 'decline' })
  })

  test('in the impact preview A alone approves nothing on a critical request: the hold does', async () => {
    vi.useFakeTimers({ toFake: [...FAKE] })
    mockPreview()
    const onRespond = await renderPreview(PUSH)
    const dialog = screen.getByRole('dialog')
    act(() => { fireEvent.keyDown(dialog, { key: 'a' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(onRespond).not.toHaveBeenCalled()
  })

  test('the approvals queue holds a critical request with the shared HoldToApprove: Space held 1.2 s approves', async () => {
    vi.useFakeTimers({ toFake: [...FAKE] })
    mockPreview()
    const { ApprovalQueue } = await load<{ ApprovalQueue: (props: Props) => JSX.Element }>('src/components/Approvals/ApprovalQueue')
    const onRespond = vi.fn(async () => undefined)
    render(<ApprovalQueue items={[{ request: request('r2', PUSH), agent: 'Codex', conversation: 'Release' }]} decided={[]} onRespond={onRespond} />)
    const hold = screen.getByRole('button', { name: /Hold to approve/ })
    act(() => { hold.focus(); fireEvent.keyDown(hold, { key: ' ' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_250) })
    expect(onRespond).toHaveBeenCalledWith('r2', { decision: 'accept' })
  })

  test('a plain approval card (no impact) lists Deny before Approve', async () => {
    const { ThreadRequestCard } = await import('../../../src/components/Threads/ThreadRequestCard')
    const Card = ThreadRequestCard as unknown as (props: Props) => JSX.Element
    render(<Card request={request('r3')} agent="Claude" disabled={false} onRespond={vi.fn(async () => undefined)} conversationId="t-1" />)
    const names = screen.getAllByRole('button').map(button => button.textContent?.trim() ?? '')
    const deny = names.findIndex(name => /^Deny/.test(name))
    const approve = names.findIndex(name => /^Approve/.test(name))
    expect(deny).toBeGreaterThanOrEqual(0)
    expect(approve).toBeGreaterThanOrEqual(0)
    expect(deny).toBeLessThan(approve)
  })
})
