// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-73, BRD-10).
// Written by the planner; the executor must not edit it. Source: the card OXE-73 spec-v1 (CA-1 to CA-5, RT-1 to RT-3),
// oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-10: "o selo abre a fila ... reusa as ações de ThreadRequestCard"),
// M1-api-e-criterios.md, the coordination's binding (the card's task adds the data-ui its measures read and turns ITS OWN
// measures to enforced) and the approval-safety rule: a risk label comes only from the catalog, from the request's
// structure (its policy, threadApprovalRisk), never from the agent's text.
// Today (main 66e0080d5) the pill dispatches OPEN_APPROVAL_QUEUE_EVENT and the Approvals center opens; there is no queue
// opened from the badge.
// Contract:
// - Clicking NeedsYouPill (while something waits) opens the queue in place: one [data-ui=needs-you-queue] holding one
//   [data-ui=needs-you-item] per pending approval of the conversations the thread store holds (snapshot and
//   snapshotCache, oldest first). Pane approvals of the Approvals store may be listed too (not frozen here).
// - Each item shows the exact command in a <code> element (mono) whose text is request.command, and two Buttons named
//   "Deny" / "Allow once" (pt-BR "Negar" / "Permitir uma vez", the strings the catalogs already hold), [data-ui=button]
//   with data-size="md" (28, 32 comfortable).
// - A decision is the one the conversation makes (RT-1, ThreadRequestCard's): window.oxe.thread.respond(threadId,
//   requestId, { decision: 'decline' | 'accept' }).
// - On open, focus moves into the queue, on the first item; J and K move it to the next and previous item (focus stays on
//   an element inside the item); D denies and A allows the focused item. A press-and-release of A on a critical item
//   (threadApprovalRisk === 'critical', e.g. policy.risk) decides nothing, then or later: it follows the card's hold rule
//   (BRD-18); D still denies it at once.
// - A critical item carries a [data-ui=risk-label] whose text is the catalog's thread:request.highRisk (policy.risk) or
//   thread:request.destructive (policy.level red); an item that is not critical has none, whatever its title says.
// - Esc closes the queue and focus goes back where it was (the pill). With the queue closed, J K D A typed in a text box
//   or a terminal are not prevented and decide nothing.
// - src/design/targets/brd-10.json (new, card OXE-73): the measures below, enforced and locked, scene needs-you-queue,
//   which e2e/brand/brand-conformance.spec.ts measures (a conversation waiting on an approval, the queue opened from the
//   pill).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NeedsYouPill } from '../../../src/components/Navigation/NeedsYouPill'
import { useActivityStore } from '../../../src/store/activity.store'
import { useApprovalsStore } from '../../../src/components/Approvals/approvals.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { ThreadRequest, ThreadSnapshot } from '../../../shared/types/thread'

const ROOT = process.cwd()
const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string

type Pin = { id: string; scene: string; prop: string; expect: Record<string, unknown> }
/** What is wrong with the card's own measures in src/design/targets (empty when they are delivered and enforced). */
function measureProblems(brd: string, card: string, pins: readonly Pin[]): string[] {
  const dir = join(ROOT, 'src/design/targets')
  const file = join(dir, `${brd.toLowerCase()}.json`)
  if (!existsSync(file)) return [`src/design/targets/${brd.toLowerCase()}.json does not exist`]
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { brd: string; card: string | null; platform: string; measures: Array<Record<string, unknown>> }
  const lock = (JSON.parse(readFileSync(join(dir, 'enforced.lock.json'), 'utf8')) as { enforced: string[] }).enforced
  // SOURCE-TEXT check (marked): the conformance spec must measure the scene, or an enforced measure is never checked.
  const spec = readFileSync(join(ROOT, 'e2e/brand/brand-conformance.spec.ts'), 'utf8')
  const problems = [...(doc.brd === brd ? [] : [`brd is ${doc.brd}`]), ...(doc.card === card ? [] : [`card is ${doc.card}`]), ...(doc.platform === 'desktop' ? [] : ['platform is not desktop'])]
  for (const pin of pins) {
    const measure = doc.measures.find(item => item.id === pin.id)
    if (!measure) { problems.push(`${pin.id} is missing`); continue }
    if (measure.state !== 'enforced') problems.push(`${pin.id} is ${String(measure.state)}`)
    if (!lock.includes(pin.id)) problems.push(`${pin.id} is not in enforced.lock.json`)
    if (measure.scene !== pin.scene) problems.push(`${pin.id} scene ${String(measure.scene)}`)
    if (measure.prop !== pin.prop) problems.push(`${pin.id} prop ${String(measure.prop)}`)
    if (JSON.stringify(measure.expect) !== JSON.stringify(pin.expect)) problems.push(`${pin.id} expect ${JSON.stringify(measure.expect)}`)
    if (JSON.stringify([...(measure.densities as string[] ?? [])].sort()) !== '["comfortable","compact"]') problems.push(`${pin.id} densities`)
    if (JSON.stringify([...(measure.themes as string[] ?? [])].sort()) !== '["dark","light"]') problems.push(`${pin.id} themes`)
    if (!new RegExp(`measureScene\\(page, '${pin.scene}'`).test(spec)) problems.push(`${pin.id}: the conformance spec does not measure scene ${pin.scene}`)
  }
  return problems
}
const QUEUE_MEASURES: readonly Pin[] = [
  { id: 'BRD-10.item-button.height', scene: 'needs-you-queue', prop: 'height', expect: { token: '--control-md' } },
  { id: 'BRD-10.command.font-family', scene: 'needs-you-queue', prop: 'font-family', expect: { token: '--font-mono' } }
]

function approval(id: string, command: string, createdAt: number, extra: Partial<ThreadRequest> = {}): ThreadRequest {
  return { id, nativeId: `n-${id}`, nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Run a command', command, generation: 1, createdAt, state: 'pending', toolName: 'Bash', availableDecisions: ['accept', 'decline'], ...extra } as ThreadRequest
}
const REQUESTS = [
  approval('r1', 'npm test -- --run auth', 1, { policy: { decision: 'ask', reasons: ['npm'], level: 'green' }, title: 'Critical: this is a low risk read' }),
  approval('r2', 'git push --force origin main', 2, { policy: { decision: 'ask', reasons: ['push'], risk: 'high' } }),
  approval('r3', 'ls -la', 3, { policy: { decision: 'ask', reasons: ['ls'], level: 'green' } })
]
let respond: ReturnType<typeof vi.fn>
function fixture(): void {
  respond = vi.fn(async () => undefined)
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { respond } } })
  const snapshot = { thread: { id: 'thread-1', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'claude', title: 'Auth', pinned: false, status: 'waiting', createdAt: 1, updatedAt: 1 },
    events: REQUESTS.map(request => ({ type: 'request', request })) } as unknown as ThreadSnapshot
  useThreadStore.setState({ snapshot, snapshotCache: {}, threads: [snapshot.thread] } as never)
  useActivityStore.setState({ live: { code: {}, thread: { 'thread-1': 'needs-you' } } } as never)
  useApprovalsStore.setState({ queue: [] } as never)
}
const queue = (): HTMLElement => {
  const found = document.querySelectorAll<HTMLElement>('[data-ui="needs-you-queue"]')
  expect(found, 'one needs-you-queue').toHaveLength(1)
  return found[0]
}
const items = (): HTMLElement[] => [...queue().querySelectorAll<HTMLElement>('[data-ui="needs-you-item"]')]
const focusedItem = (): number => items().findIndex(item => item.contains(document.activeElement))
function open(): HTMLElement {
  const pill = screen.getByTestId('needs-you-pill')
  pill.focus()
  fireEvent.click(pill)
  return pill
}
const key = (code: string): void => { fireEvent.keyDown(document.activeElement ?? document.body, { key: code }); fireEvent.keyUp(document.activeElement ?? document.body, { key: code }) }

beforeEach(fixture)
afterEach(async () => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-73 BRD-10 the needs-you queue (A26)', () => {
  it.each([['en', 'Deny', 'Allow once'], ['pt-BR', 'Negar', 'Permitir uma vez']])('the pill (%s) opens the queue: one item per request, the exact command in mono, Deny and Allow once', async (locale, deny, allow) => {
    await changeLanguage(locale)
    render(<NeedsYouPill />)
    open()
    expect(items()).toHaveLength(3)
    items().forEach((item, index) => {
      const code = item.querySelector('code')
      expect(code?.textContent, `item ${index} shows its command`).toBe(REQUESTS[index].command)
      for (const name of [deny, allow]) {
        const button = within(item).getByRole('button', { name })
        expect(button).toHaveAttribute('data-ui', 'button')
        expect(button).toHaveAttribute('data-size', 'md')
      }
    })
    fireEvent.click(within(items()[0]).getByRole('button', { name: deny }))
    expect(respond).toHaveBeenCalledWith('thread-1', 'r1', { decision: 'decline' })
  })

  it('J and K move the focus, D denies and A allows the focused item', () => {
    render(<NeedsYouPill />)
    open()
    expect(focusedItem()).toBe(0)
    key('j')
    expect(focusedItem()).toBe(1)
    key('j')
    expect(focusedItem()).toBe(2)
    key('k')
    key('k')
    expect(focusedItem()).toBe(0)
    key('a')
    expect(respond).toHaveBeenCalledWith('thread-1', 'r1', { decision: 'accept' })
    key('j')
    key('j')
    key('d')
    expect(respond).toHaveBeenCalledWith('thread-1', 'r3', { decision: 'decline' })
  })

  it('a critical item is not allowed by a press of A, then or later; D still denies it', () => {
    vi.useFakeTimers()
    render(<NeedsYouPill />)
    open()
    key('j')
    expect(focusedItem()).toBe(1)
    key('a')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(respond.mock.calls.filter(call => call[1] === 'r2' && (call[2] as { decision: string }).decision === 'accept')).toEqual([])
    key('d')
    expect(respond).toHaveBeenCalledWith('thread-1', 'r2', { decision: 'decline' })
  })

  it('the risk label comes from the catalog and the request\'s policy, never from the agent\'s text', () => {
    render(<NeedsYouPill />)
    open()
    const labels = items().map(item => [...item.querySelectorAll('[data-ui="risk-label"]')].map(el => (el.textContent ?? '').trim()))
    expect(labels).toEqual([[], [tt('request.highRisk')], []])
  })

  it('Esc closes the queue and gives the focus back; closed, J K D A type normally', () => {
    render(<><NeedsYouPill /><textarea aria-label="composer" /><div className="xterm" tabIndex={0} data-testid="terminal" /></>)
    const pill = open()
    expect(items()).toHaveLength(3)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(document.querySelectorAll('[data-ui="needs-you-queue"]')).toHaveLength(0)
    expect(document.activeElement).toBe(pill)
    for (const target of [screen.getByRole('textbox', { name: 'composer' }), screen.getByTestId('terminal')]) {
      target.focus()
      for (const letter of ['j', 'k', 'd', 'a']) expect(fireEvent.keyDown(target, { key: letter }), `${letter} is not prevented`).toBe(true)
    }
    expect(respond).not.toHaveBeenCalled()
  })

  it('turns its own BRD-10 measures to enforced', () => {
    expect(measureProblems('BRD-10', 'OXE-73', QUEUE_MEASURES)).toEqual([])
  })
})
