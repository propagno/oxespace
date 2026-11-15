// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-73, BRD-10;
// with bug OXE-176). Written by the planner; the executor must not edit it. Source: the card OXE-73 spec-v1 (CA-1 to CA-5,
// RT-1 to RT-3), oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-10), M1-api-e-criterios.md, the brand's and the
// coordination's inputs of 15/11 (AG-03 grouping Precisa de você, Falhou, Trabalhando; risk-gated inline actions: a
// critical request offers only "Ver impacto"; OXE-176: one row per waiting terminal with "Ir ao terminal"; the pill's
// number is the queue's pending rows), the coordination's binding (the card's task adds the data-ui its measures read and
// turns ITS OWN measures to enforced) and the approval-safety rule: a risk label comes only from the catalog, from the
// request's structure (its policy, threadApprovalRisk), never from the agent's text.
// Today (main 66e0080d5) the pill dispatches OPEN_APPROVAL_QUEUE_EVENT and the Approvals center opens, which lists formal
// requests only, while the pill also counts waiting OxeCode terminals (OXE-176: "1 needs you", then "All clear").
// Contract:
// - Clicking NeedsYouPill opens the queue in place: one [data-ui=needs-you-queue] with groups [data-ui=needs-you-group] in
//   this order, each only when it has rows, data-state needs-you | failed | working, its heading the state word (pt-BR
//   Precisa de você / Falhou / Trabalhando; en Needs you / Failed / Working). Failed and Working show at most 3 rows
//   ([data-ui=needs-you-row]) and then a "+N" line for the rest (activity store live entries, code and thread). The
//   Needs-you cap is the brand's open question: not frozen here (the fixtures keep that group at 3 rows or fewer).
// - Needs you: one [data-ui=needs-you-item] per pending approval of the conversations the thread store holds (snapshot and
//   snapshotCache, oldest first), then one per waiting OxeCode terminal (OXE-176: the panes the attention feed counts as
//   needs-you, from the workspace and terminal stores); data-kind "request" | "pane".
// - A request item shows the exact command in a <code> element (mono) whose text is request.command. Not critical: two
//   Buttons "Deny" / "Allow once" (pt-BR "Negar" / "Permitir uma vez"), [data-ui=button] data-size="md" (28, 32
//   comfortable); a decision is ThreadRequestCard's, window.oxe.thread.respond(threadId, requestId, { decision }) (RT-1).
//   Critical (threadApprovalRisk 'critical', e.g. policy.risk): only "See impact" / "Ver impacto" (thread:f7.card.seeImpact),
//   which opens the request's impact (useOpenRequest.open(requestId)); no Deny, no Allow, and A never allows it. A critical
//   item carries a [data-ui=risk-label] whose text is the catalog's thread:request.highRisk (policy.risk) or
//   thread:request.destructive (policy.level red); any other item has none, whatever its title says.
// - A pane item (OXE-176): a StatusSignal needs-you ([data-ui=status-signal][data-state=needs-you]), "{workspace} ›
//   {agent or pane name}", the text thread:f7.queue.paneWaiting ("Esperando você no terminal") and a Button sm named
//   thread:f7.queue.goToPane ("Ir ao terminal") that goes to the pane through OXE-128's path (openActivityTarget: the
//   terminal store's active pane becomes it); no Deny or Allow on it.
// - The pill's number equals the queue's pending rows (the needs-you items); "All clear" (thread:f7.queue.allClearTitle)
//   never shows while one is pending.
// - On open, focus moves into the queue, on the first item; J and K move it to the next and previous item; D denies and A
//   allows the focused request item (not critical). Esc closes the queue and focus goes back to the pill. With the queue
//   closed, J K D A typed in a text box or a terminal are not prevented and decide nothing.
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
import { useOpenRequest } from '../../../src/components/Approvals/openRequest'
import { useThreadStore } from '../../../src/store/thread.store'
import { useTerminalStore, type TerminalStateEntry } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { ThreadRequest, ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'

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
const R1 = approval('r1', 'npm test -- --run auth', 1, { policy: { decision: 'ask', reasons: ['npm'], level: 'green' }, title: 'Critical: this is a low risk read' })
const R2 = approval('r2', 'git push --force origin main', 2, { policy: { decision: 'ask', reasons: ['push'], risk: 'high' } })
const R3 = approval('r3', 'ls -la', 3, { policy: { decision: 'ask', reasons: ['ls'], level: 'green' } })
const RUNNING = { status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: null, hookAt: null, agentState: null, agentSource: null, location: null, detached: false }
const paneOf = (id: string, agentName: string | null): WorkspacePane => ({ id, workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName, displayName: null, shellProfileId: 'builtin-claude', rootPath: null, createdAt: null }) as unknown as WorkspacePane
let respond: ReturnType<typeof vi.fn>
/** Requests in one conversation; `blocked` panes wait in the terminal (the attention feed counts them as needs-you). */
function fixture(requests: ThreadRequest[], blocked: string[] = []): void {
  respond = vi.fn(async () => undefined)
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { respond } } })
  const snapshot = { thread: { id: 'thread-1', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'claude', title: 'Auth', pinned: false, status: 'waiting', createdAt: 1, updatedAt: 1 },
    events: requests.map(request => ({ type: 'request', request })) } as unknown as ThreadSnapshot
  const panes = ['pane-1', 'pane-2'].map((id, index) => paneOf(id, index === 0 ? 'Claude' : null))
  act(() => {
    useApprovalsStore.setState({ queue: [] } as never)
    useOpenRequest.setState({ requestId: null })
    useThreadStore.setState({ snapshot, snapshotCache: {}, threads: [snapshot.thread] } as never)
    useWorkspaceStore.setState({ workspaces: [{ id: 'ws-1', name: 'demo-repo', rootPath: '/repo', defaultShellProfileId: 'builtin-claude', panes } as unknown as Workspace] } as never)
    useTerminalStore.setState({ activePaneId: null, panes: Object.fromEntries(panes.map(pane => [pane.id, { ...RUNNING, agentState: blocked.includes(pane.id) ? 'blocked' : null } as unknown as TerminalStateEntry])) } as never)
    setLive({ code: Object.fromEntries(blocked.map(id => [id, 'needs-you'])), thread: requests.length ? { 'thread-1': 'needs-you' } : {} })
  })
}
function setLive(live: { code: Record<string, string>; thread: Record<string, string> }): void {
  useActivityStore.setState({ live } as never)
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
const decided = (id: string, decision: string): boolean => respond.mock.calls.some(call => call[1] === id && (call[2] as { decision?: string } | undefined)?.decision === decision)

beforeEach(() => fixture([R1, R2, R3]))
afterEach(async () => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-73 BRD-10 the needs-you queue (A26)', () => {
  it.each([['en', 'Deny', 'Allow once', 'See impact'], ['pt-BR', 'Negar', 'Permitir uma vez', 'Ver impacto']])('the pill (%s) opens the queue: the exact command, Deny and Allow once, and only See impact on a critical request', async (locale, deny, allow, impact) => {
    await changeLanguage(locale)
    render(<NeedsYouPill />)
    open()
    expect(items()).toHaveLength(3)
    items().forEach((item, index) => {
      expect(item).toHaveAttribute('data-kind', 'request')
      expect(item.querySelector('code')?.textContent, `item ${index} shows its command`).toBe([R1, R2, R3][index].command)
    })
    for (const index of [0, 2]) {
      for (const name of [deny, allow]) {
        const button = within(items()[index]).getByRole('button', { name })
        expect(button).toHaveAttribute('data-ui', 'button')
        expect(button).toHaveAttribute('data-size', 'md')
      }
      expect(within(items()[index]).queryByRole('button', { name: impact })).toBeNull()
    }
    const critical = items()[1]
    expect(within(critical).queryByRole('button', { name: deny })).toBeNull()
    expect(within(critical).queryByRole('button', { name: allow })).toBeNull()
    fireEvent.click(within(critical).getByRole('button', { name: impact }))
    expect(useOpenRequest.getState().requestId).toBe('r2')
    fireEvent.click(within(items()[0]).getByRole('button', { name: deny }))
    expect(respond).toHaveBeenCalledWith('thread-1', 'r1', { decision: 'decline' })
    expect(decided('r2', 'accept') || decided('r2', 'decline')).toBe(false)
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

  it('a critical item is never allowed from the queue, by a press or by holding', () => {
    vi.useFakeTimers()
    render(<NeedsYouPill />)
    open()
    key('j')
    expect(focusedItem()).toBe(1)
    key('a')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'a' })
    act(() => { vi.advanceTimersByTime(3_000) })
    fireEvent.keyUp(document.activeElement ?? document.body, { key: 'a' })
    expect(decided('r2', 'accept')).toBe(false)
  })

  it('the risk label comes from the catalog and the request\'s policy, never from the agent\'s text', () => {
    render(<NeedsYouPill />)
    open()
    const labels = items().map(item => [...item.querySelectorAll('[data-ui="risk-label"]')].map(el => (el.textContent ?? '').trim()))
    expect(labels).toEqual([[], [tt('request.highRisk')], []])
  })

  it.each(['en', 'pt-BR'])('OXE-176 (%s): a waiting terminal is a row after the requests, with Ir ao terminal and no decision; the pill counts the rows', async locale => {
    await changeLanguage(locale)
    fixture([R1, R3], ['pane-1'])
    render(<NeedsYouPill />)
    expect(screen.getByTestId('needs-you-pill')).toHaveTextContent(i18n.t('attention.needsYou', { count: 3 }) as string)
    open()
    expect(items().map(item => item.getAttribute('data-kind'))).toEqual(['request', 'request', 'pane'])
    const row = items()[2]
    expect(row.querySelectorAll('[data-ui="status-signal"][data-state="needs-you"]')).toHaveLength(1)
    expect((row.textContent ?? '').replace(/\s+/g, ' ')).toContain('demo-repo › Claude')
    expect(tt('f7.queue.paneWaiting')).not.toBe('f7.queue.paneWaiting')
    expect(row).toHaveTextContent(tt('f7.queue.paneWaiting'))
    if (locale === 'pt-BR') expect(row).toHaveTextContent('Esperando você no terminal')
    const go = within(row).getByRole('button', { name: tt('f7.queue.goToPane') })
    if (locale === 'pt-BR') expect(go).toHaveAccessibleName('Ir ao terminal')
    expect(go).toHaveAttribute('data-size', 'sm')
    for (const name of [/^(deny|negar)$/i, /^(allow once|permitir uma vez)$/i]) expect(within(row).queryByRole('button', { name })).toBeNull()
    expect(queue().textContent ?? '').not.toContain(tt('f7.queue.allClearTitle'))
    fireEvent.click(go)
    expect(useTerminalStore.getState().activePaneId).toBe('pane-1')
    expect(respond).not.toHaveBeenCalled()
  })

  it.each([['pt-BR', ['Precisa de você', 'Falhou', 'Trabalhando']], ['en', ['Needs you', 'Failed', 'Working']]])('groups (%s): needs you, then failed, then working; at most 3 rows and "+N"', async (locale, words) => {
    await changeLanguage(locale)
    fixture([R1])
    const many = (prefix: string, count: number, state: string): Record<string, string> => Object.fromEntries(Array.from({ length: count }, (_, index) => [`${prefix}-${index}`, state]))
    act(() => setLive({ code: { ...many('pane-f', 2, 'failed'), ...many('pane-w', 3, 'working') }, thread: { 'thread-1': 'needs-you', ...many('thread-f', 2, 'failed'), ...many('thread-w', 2, 'working') } }))
    render(<NeedsYouPill />)
    open()
    const groups = [...queue().querySelectorAll<HTMLElement>('[data-ui="needs-you-group"]')]
    expect(groups.map(group => group.getAttribute('data-state'))).toEqual(['needs-you', 'failed', 'working'])
    groups.forEach((group, index) => expect(group.textContent ?? '', `group ${index} names its state`).toContain(words[index]))
    const rows = (group: HTMLElement): number => group.querySelectorAll('[data-ui="needs-you-row"]').length
    expect([rows(groups[1]), rows(groups[2])]).toEqual([3, 3])
    expect(groups[1].textContent ?? '').toMatch(/\+1(\D|$)/)
    expect(groups[2].textContent ?? '').toMatch(/\+2(\D|$)/)
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
