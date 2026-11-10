// Frozen acceptance test for 1.5.0 A24 on screen (DESIGN U7.1, OXE program, phase F7, task FE-AP1). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f7-design.md (U7.1).
// Contract (BACKEND #714 §Contract): ThreadRequest.impact = { why?, where, whereSub?, affects { count, unit }, reversible,
// undoHow? ('checkpoint' | 'start'), risk, kind ('db' | 'command' | 'file' | 'container' | 'push'), text, lang }. The renderer parts:
// - ThreadRequestCard gains an `agent` prop; with request.impact it is the F7 card (src/components/Threads/ThreadRequestCard.tsx);
// - ApprovalToast({ request, agent, onRespond, onSeeImpact, onClose }) in src/components/Approvals/ApprovalToast.tsx: 12 s,
//   held while hovered or focused, polite, and it waits while a modal dialog is open;
// - ApprovalQueue({ items: [{ request, agent, conversation }], decided: [{ id, title, agent, outcome }], onRespond(id, response),
//   }) in src/components/Approvals/ApprovalQueue.tsx, with the selected request's ImpactPreview on its right (DESIGN M5 on
//   #716: A is the 1.2 s hold on a critical one, focuses Approve on a high irreversible one, approves a reversible one);
//   Ctrl Shift A opens it (keybinding approvals.queue).
// U7.1a's step counts across the app are the e2e approvals-anywhere.spec; these pin each door's own steps.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Props = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const REVERSIBLE = { why: 'Runs the unit tests before the commit.', where: 'shop', whereSub: 'web', affects: { count: 2, unit: 'files' }, reversible: true, undoHow: 'checkpoint', risk: 'low', kind: 'file', text: 'apply_patch src/a.ts src/b.ts', lang: 'diff' }
const HIGH_DB = { why: 'Clears old carts.', where: 'shop', whereSub: 'dev', affects: { count: 3, unit: 'rows' }, reversible: false, risk: 'high', kind: 'db', text: 'DELETE FROM carts WHERE id < 4', lang: 'sql' }
const IRREVERSIBLE = { why: 'Publishes the package.', where: 'shop', affects: { count: 1, unit: 'resources' }, reversible: false, risk: 'critical', kind: 'push', text: 'npm publish', lang: 'shell' }
const request = (id: string, impact: Props, title = 'Edit two files', createdAt = 1) => ({
  id, nativeId: `n-${id}`, nativeMethod: 'can_use_tool:Bash', kind: 'approval', title, toolName: 'Bash', command: impact.text,
  generation: 1, createdAt, state: 'pending', availableDecisions: ['accept', 'decline'], impact
})

async function renderCard(impact: Props) {
  const { ThreadRequestCard } = await import('../../../src/components/Threads/ThreadRequestCard')
  const onRespond = vi.fn(async () => undefined)
  const Card = ThreadRequestCard as unknown as (props: Props) => JSX.Element
  render(<Card request={request('r1', impact)} agent="Claude" disabled={false} onRespond={onRespond} conversationId="t-1" />)
  return onRespond
}
const actionButtons = () => screen.getAllByRole('button').map(button => button.textContent?.replace(/\s+[DA]$/, '').trim())

afterEach(async () => { cleanup(); vi.useRealTimers(); await changeLanguage('en') })

describe('U7.1 · A request comes to you', () => {
  test('a reversible card names the agent, the why, the facts and the exact text, with Deny first and focused', { timeout: 30_000 }, async () => {
    await renderCard(REVERSIBLE)
    expect(await screen.findByText('Claude needs your approval')).toBeInTheDocument()
    expect(screen.getByText('Edit two files')).toBeInTheDocument()
    expect(screen.getByText('Runs the unit tests before the commit.')).toBeInTheDocument()
    expect(screen.getByText(/shop/)).toBeInTheDocument()
    expect(screen.getByText(/2 files/)).toBeInTheDocument()
    expect(screen.getByText('Can be undone')).toBeInTheDocument()
    expect(screen.getByText('apply_patch src/a.ts src/b.ts')).toBeInTheDocument()
    expect(actionButtons()).toEqual(['Deny', 'Allow', 'Copy exact text'])
    expect(screen.getByRole('button', { name: /^Deny/ })).toHaveFocus()
  })

  test('an irreversible card says it cannot be undone and offers See impact, never Allow', { timeout: 30_000 }, async () => {
    const onRespond = await renderCard(IRREVERSIBLE)
    expect(await screen.findByText("Can't be undone")).toBeInTheDocument()
    expect(actionButtons()).toEqual(['Deny', 'See impact', 'Copy exact text'])
    expect(screen.queryByRole('button', { name: /^(Allow|Approve)/ })).toBeNull()
    expect(onRespond).not.toHaveBeenCalled()
  })

  test('a high, irreversible card (a dev database write) is the same two steps: Deny and See impact, never Allow', { timeout: 30_000 }, async () => {
    const onRespond = await renderCard({ ...IRREVERSIBLE, risk: 'high', kind: 'db', affects: { count: 42, unit: 'rows' }, text: 'DELETE FROM carts WHERE id = 1', lang: 'sql' })
    expect(await screen.findByText("Can't be undone")).toBeInTheDocument()
    expect(actionButtons()).toEqual(['Deny', 'See impact', 'Copy exact text'])
    expect(onRespond).not.toHaveBeenCalled()
  })

  test('Enter on the focused Deny denies in one step; Enter never approves an irreversible request', { timeout: 30_000 }, async () => {
    const onRespond = await renderCard(IRREVERSIBLE)
    expect(await screen.findByRole('button', { name: /^Deny/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith({ decision: 'decline' })
  })

  test('a reversible allow from the card is one step', { timeout: 30_000 }, async () => {
    const onRespond = await renderCard(REVERSIBLE)
    await userEvent.click(await screen.findByRole('button', { name: /^Allow/ }))
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' })
  })

  test('Copy exact text copies the text exactly as it runs', { timeout: 30_000 }, async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderCard(IRREVERSIBLE)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy exact text' }))
    expect(writeText).toHaveBeenCalledWith('npm publish')
  })

  test('the card reads in pt-BR', { timeout: 30_000 }, async () => {
    await changeLanguage('pt-BR')
    await renderCard(IRREVERSIBLE)
    expect(await screen.findByText('Claude precisa da sua aprovação')).toBeInTheDocument()
    expect(screen.getByText('Não dá para desfazer')).toBeInTheDocument()
    expect(actionButtons()).toEqual(['Negar', 'Ver impacto', 'Copiar o texto exato'])
  })

  async function renderToast(impact: Props) {
    const { ApprovalToast } = await load<{ ApprovalToast: (props: Props) => JSX.Element | null }>('src/components/Approvals/ApprovalToast')
    const props = { request: request('r1', impact, 'Run npm publish'), agent: 'Claude', onRespond: vi.fn(async () => undefined), onSeeImpact: vi.fn(), onClose: vi.fn() }
    const view = render(<ApprovalToast {...props} />)
    return { ...props, view, ApprovalToast }
  }

  test('the toast reads "Needs you: title · agent", is polite, and a reversible one denies or allows in one step', async () => {
    const toast = await renderToast(REVERSIBLE)
    const status = await screen.findByText('Needs you: Run npm publish · Claude')
    expect(status.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
    expect(actionButtons()).toEqual(['Deny', 'Allow'])
    expect(screen.getByRole('button', { name: /^Deny/ })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: /^Allow/ }))
    expect(toast.onRespond).toHaveBeenCalledTimes(1)
    expect(toast.onRespond).toHaveBeenCalledWith({ decision: 'accept' })
  })

  test('an irreversible toast offers only Deny and See impact; See impact opens the preview and answers nothing', async () => {
    const toast = await renderToast(IRREVERSIBLE)
    expect(actionButtons()).toEqual(['Deny', 'See impact'])
    await userEvent.click(screen.getByRole('button', { name: 'See impact' }))
    expect(toast.onSeeImpact).toHaveBeenCalledTimes(1)
    expect(toast.onRespond).not.toHaveBeenCalled()
  })

  test('the toast closes after 12 s, and stays while hovered or focused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
    const toast = await renderToast(REVERSIBLE)
    const region = screen.getByText('Needs you: Run npm publish · Claude').closest('[aria-live]')!
    act(() => { fireEvent.mouseEnter(region) })
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(toast.onClose).not.toHaveBeenCalled()
    act(() => { fireEvent.mouseLeave(region); fireEvent.focus(screen.getByRole('button', { name: /^Deny/ })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(toast.onClose).not.toHaveBeenCalled()
    act(() => { fireEvent.blur(screen.getByRole('button', { name: /^Deny/ })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000) })
    expect(toast.onClose).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
    expect(toast.onClose).toHaveBeenCalledTimes(1)
  })

  test('the toast never covers an open dialog: it waits until the dialog closes', async () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.append(dialog)
    try {
      await renderToast(REVERSIBLE)
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
      expect(screen.queryByText('Needs you: Run npm publish · Claude')).toBeNull()
    } finally { dialog.remove() }
    expect(await screen.findByText('Needs you: Run npm publish · Claude', undefined, { timeout: 3_000 })).toBeInTheDocument()
  })

  test('the toast reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    await renderToast(IRREVERSIBLE)
    expect(await screen.findByText('Precisa de você: Run npm publish · Claude')).toBeInTheDocument()
    expect(actionButtons()).toEqual(['Negar', 'Ver impacto'])
  })

  async function renderQueue() {
    const { ApprovalQueue } = await load<{ ApprovalQueue: (props: Props) => JSX.Element }>('src/components/Approvals/ApprovalQueue')
    const items = [
      { request: request('r3', HIGH_DB, 'Delete old carts', 30), agent: 'Claude', conversation: 'Cleanup' },
      { request: request('r2', IRREVERSIBLE, 'Run npm publish', 20), agent: 'Codex', conversation: 'Release' },
      { request: request('r1', REVERSIBLE, 'Edit two files', 10), agent: 'Claude', conversation: 'Checkout' }
    ]
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, approvals: { preview: vi.fn(async () => ({ status: 'ok', count: 3, sample: { cols: ['id'], rows: [[1], [2], [3]] } })) } } })
    const decided = [{ id: 'r0', title: 'Run npm test', agent: 'Claude', outcome: 'approved' }]
    const onRespond = vi.fn(async () => undefined)
    render(<ApprovalQueue items={items} decided={decided} onRespond={onRespond} />)
    return { onRespond }
  }

  test('the queue lists every pending request oldest first, with Decided today below and read only, followed by Active across OxeChat & OxeCode · {n} (S7.1 AgentsReadModel) and the ≤ 18-word All clear copy when nothing waits', async () => {
    const { ApprovalQueue } = await load<{ ApprovalQueue: (props: Props) => JSX.Element }>('src/components/Approvals/ApprovalQueue')
    const activeAgents = [
      { kind: 'thread', id: 't-1', title: 'Checkout refactor', provider: 'claude', status: 'working', workspaceName: 'shop', workspaceId: 'ws-1', updatedAt: 10 },
      { kind: 'pane', id: 'p-1', title: 'Codex CLI', provider: 'codex', status: 'working', workspaceName: 'shop', workspaceId: 'ws-1', paneId: 'p-1', updatedAt: 9 }
    ]
    Object.assign(window, {
      oxe: {
        ...(window as unknown as { oxe?: object }).oxe,
        approvals: { preview: vi.fn(async () => ({ status: 'ok', count: 3, sample: { cols: ['id'], rows: [[1], [2], [3]] } })) },
        agents: { list: vi.fn(async () => activeAgents), onChanged: vi.fn(() => () => undefined) }
      }
    })
    const items = [
      { request: request('r3', HIGH_DB, 'Delete old carts', 30), agent: 'Claude', conversation: 'Cleanup' },
      { request: request('r2', IRREVERSIBLE, 'Run npm publish', 20), agent: 'Codex', conversation: 'Release' },
      { request: request('r1', REVERSIBLE, 'Edit two files', 10), agent: 'Claude', conversation: 'Checkout' }
    ]
    const decided = [{ id: 'r0', title: 'Run npm test', agent: 'Claude', outcome: 'approved' }]
    const { unmount } = render(<ApprovalQueue items={items} decided={decided} onRespond={vi.fn(async () => undefined)} />)
    const pending = await screen.findAllByRole('option')
    expect(pending.map(option => within(option).getByText(/Edit two files|Run npm publish|Delete old carts/).textContent)).toEqual(['Edit two files', 'Run npm publish', 'Delete old carts'])
    const decidedRegion = screen.getByRole('region', { name: 'Decided today' })
    expect(within(decidedRegion).getByText('Run npm test')).toBeInTheDocument()
    expect(within(decidedRegion).queryAllByRole('button')).toEqual([])
    expect(await screen.findByText(/Active across OxeChat & OxeCode · 2/)).toBeInTheDocument()
    expect(screen.getByText('Checkout refactor')).toBeInTheDocument()
    expect(screen.getByText('Codex CLI')).toBeInTheDocument()
    unmount()

    render(<ApprovalQueue items={[]} decided={[]} onRespond={vi.fn(async () => undefined)} />)
    const allClearCopy = "Requests outside an agent's permissions wait here and on your paired phone. Database writes stay on this computer."
    expect(await screen.findByText(allClearCopy)).toBeInTheDocument()
    expect(allClearCopy.trim().split(/\s+/).length).toBeLessThanOrEqual(18)
  })

  test('approval titles deduplicate impact.where when the title already includes where (case-insensitive)', async () => {
    const { ApprovalQueue } = await load<{ ApprovalQueue: (props: Props) => JSX.Element }>('src/components/Approvals/ApprovalQueue')
    Object.assign(window, {
      oxe: {
        ...(window as unknown as { oxe?: object }).oxe,
        approvals: { preview: vi.fn(async () => ({ status: 'ok', count: 3, sample: { cols: ['id'], rows: [[1]] } })) }
      }
    })
    const dupImpact = { ...HIGH_DB, where: 'billing-staging' }
    render(<ApprovalQueue items={[{ request: request('r-dup', dupImpact, 'Update 1,284 invoices on Billing-Staging', 10), agent: 'Claude', conversation: 'Billing' }]} decided={[]} onRespond={vi.fn(async () => undefined)} />)
    const opt = await screen.findByRole('option')
    const matches = opt.textContent?.match(/billing-staging/gi) ?? []
    expect(matches.length).toBe(1)
  })

  test('in the queue J and K move, D denies the selected request, and A allows a reversible one', async () => {
    const queue = await renderQueue()
    const list = await screen.findByRole('listbox')
    list.focus()
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('j')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('d')
    expect(queue.onRespond).toHaveBeenCalledWith('r2', { decision: 'decline' })
    await userEvent.keyboard('k')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('a')
    expect(queue.onRespond).toHaveBeenCalledWith('r1', { decision: 'accept' })
  })

  test('in the queue A on a critical request is the 1.2 s hold: a short press approves nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const queue = await renderQueue()
    const list = screen.getByRole('listbox')
    act(() => { list.focus(); fireEvent.keyDown(list, { key: 'j' }); fireEvent.keyUp(list, { key: 'j' }) })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    act(() => { fireEvent.keyDown(document.activeElement ?? list, { key: 'a' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    act(() => { fireEvent.keyUp(document.activeElement ?? list, { key: 'a' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(queue.onRespond).not.toHaveBeenCalled()
    act(() => { fireEvent.keyDown(document.activeElement ?? list, { key: 'a' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_250) })
    expect(queue.onRespond).toHaveBeenCalledWith('r2', { decision: 'accept' })
  })

  test('in the queue A on a high, irreversible request focuses Approve; only Enter or a click then approves', async () => {
    const queue = await renderQueue()
    const list = await screen.findByRole('listbox')
    list.focus()
    await userEvent.keyboard('jj')
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('a')
    expect(queue.onRespond).not.toHaveBeenCalled()
    const approve = await screen.findByRole('button', { name: /^Approve/ })
    expect(approve).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(queue.onRespond).toHaveBeenCalledWith('r3', { decision: 'accept' })
  })

  test('Ctrl Shift A opens the queue, and no other shortcut takes the chord', async () => {
    const { KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.filter(binding => (binding.chords as readonly string[]).includes('Mod+Shift+A')).map(binding => binding.id as string)).toEqual(['approvals.queue'])
  })
})
