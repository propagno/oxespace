// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-73, BRD-10;
// with bug OXE-176), the window part. Written by the planner; the executor must not edit it. Source: the card OXE-73
// spec-v1 (CA-1 to CA-5, RT-1 to RT-3), oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-10), M1-api-e-criterios.md, the
// brand's and the coordination's inputs of 15/11 (AG-03 grouping Precisa de você, Falhou, Trabalhando; risk-gated inline
// actions: a critical request offers only "Ver impacto"; OXE-176: one row per waiting terminal with "Ir ao terminal"; the
// pill's number is the queue's pending rows), the user's rule of 15/11 ("o backend deve acompanhar": the queue reads main's
// aggregation, never a renderer guess), the coordination's binding (the card's task adds the data-ui its measures read and
// turns ITS OWN measures to enforced) and the approval-safety rule: a risk label comes only from the catalog, over the risk
// main computed, never from the agent's text.
// Today (main 66e0080d5) the pill counts from the window's attention feed and dispatches OPEN_APPROVAL_QUEUE_EVENT; the
// Approvals center lists formal requests only (OXE-176: "1 needs you", then "All clear").
// Contract:
// - Source: main's agents overview (window.oxe.agents.overview() and onChanged; electron/main/services/agents/
//   agents-read-model.ts, with the command and the policy risk of A34). The pill's number is the queue's pending rows: every
//   answerable request of a needs-you row plus every needs-you pane row; nothing waiting, no pill (A24).
// - Clicking NeedsYouPill opens the queue in place: one [data-ui=needs-you-queue] with groups [data-ui=needs-you-group] in
//   this order, each only when it has rows, data-state needs-you | failed | working, its heading the state word (pt-BR
//   Precisa de você / Falhou / Trabalhando; en Needs you / Failed / Working). Failed and Working show at most 3 rows
//   ([data-ui=needs-you-row]) and then a "+N" line for the rest. The Needs-you cap is the brand's open question: not
//   frozen here (the fixtures keep that group at 3 rows or fewer).
// - Needs you: one [data-ui=needs-you-item] data-kind="request" per answerable request (oldest first), then one
//   data-kind="pane" per waiting terminal (OXE-176).
// - A request item shows the exact command (summary.command.text) in a <code> element (mono). Not critical: Buttons
//   "Deny" / "Allow once" (pt-BR "Negar" / "Permitir uma vez"), [data-ui=button] data-size="md" (28, 32 comfortable); a
//   decision is the conversation's (RT-1): window.oxe.thread.respond(threadId, requestId, { decision }). Critical
//   (summary.risk 'critical'): only "See impact" / "Ver impacto" (thread:f7.card.seeImpact), which opens the request's
//   impact (useOpenRequest.open(requestId)); no Deny, no Allow, and A never allows it. A critical item carries a
//   [data-ui=risk-label] with the catalog's risk word (common:approvals.risk.critical); any other item has none, whatever
//   its command says.
// - A pane item (OXE-176): a StatusSignal needs-you ([data-ui=status-signal][data-state=needs-you]), "{workspace} ›
//   {agent or pane name}" (workspace name from the workspace store, agent from the row), the text
//   thread:f7.queue.paneWaiting ("Esperando você no terminal") and a Button sm named thread:f7.queue.goToPane ("Ir ao
//   terminal") that goes to the pane through OXE-128's path (openActivityTarget: the terminal store's active pane becomes
//   it); no Deny or Allow on it. "All clear" (thread:f7.queue.allClearTitle) never shows while a row is pending.
// - On open, focus moves into the queue, on the first item; J and K move it to the next and previous item; D denies and A
//   allows the focused request item (not critical). Esc closes the queue and focus goes back to the pill. With the queue
//   closed, J K D A typed in a text box or a terminal are not prevented and decide nothing.
// - src/design/targets/brd-10.json (new, card OXE-73): the measures below, enforced and locked, scene needs-you-queue,
//   which e2e/brand/brand-conformance.spec.ts measures.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NeedsYouPill } from '../../../src/components/Navigation/NeedsYouPill'
import { useActivityStore } from '../../../src/store/activity.store'
import { useApprovalsStore } from '../../../src/components/Approvals/approvals.store'
import { useOpenRequest } from '../../../src/components/Approvals/openRequest'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { AgentRow } from '../../../shared/types/agents'
import type { Workspace } from '../../../shared/types/workspace'

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

const COMMANDS = { r1: 'echo "Critical: this is a low risk read"', r2: 'git push --force origin main', r3: 'ls -la' } as const
type Risk = 'low' | 'medium' | 'high' | 'critical'
const request = (requestId: keyof typeof COMMANDS, since: number, risk: Risk) =>
  ({ requestId, kind: 'approval', title: { code: 'agents.request.approval', params: {} }, risk, reversible: null, answerable: true, since, command: { text: COMMANDS[requestId], untrusted: true } })
const threadRow = (requests: ReturnType<typeof request>[]): AgentRow => ({ kind: 'thread', id: 'thread-1', state: 'needs-you', provider: 'claude', mode: 'thread', title: 'Auth', workspaceId: 'ws-1', since: 1, seenAt: null,
  session: null, worktree: null, cost: null, requests }) as unknown as AgentRow
const paneRow = (id: string, state: string, title = 'Claude'): AgentRow => ({ kind: 'pane', id, state, provider: 'claude', mode: 'code', title, workspaceId: 'ws-1', since: 10, seenAt: null, session: null, worktree: null, cost: null,
  requests: state === 'needs-you' ? [{ requestId: `pane:${id}:3`, kind: 'approval', title: { code: 'agents.request.pane', params: {} }, risk: null, reversible: null, answerable: false, since: 10 }] : [] }) as unknown as AgentRow
const other = (id: string, state: string, mode: 'code' | 'thread'): AgentRow => mode === 'code' ? paneRow(id, state, `Agent ${id}`)
  : ({ kind: 'thread', id, state, provider: 'codex', mode, title: `Conversation ${id}`, workspaceId: 'ws-1', since: 5, seenAt: null, session: null, worktree: null, cost: null, requests: [] }) as unknown as AgentRow
const THREE = threadRow([request('r1', 1, 'low'), request('r2', 2, 'critical'), request('r3', 3, 'low')])

let respond: ReturnType<typeof vi.fn>
function fixture(agents: AgentRow[]): void {
  respond = vi.fn(async () => undefined)
  const sources = { panes: { ok: true }, threads: { ok: true }, delegations: { ok: true }, work: { ok: true } }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { respond }, agents: { overview: vi.fn(async () => ({ agents, sources })), onChanged: vi.fn(() => () => undefined), markSeen: vi.fn(async () => undefined) } } })
  act(() => {
    useApprovalsStore.setState({ queue: [] } as never)
    useOpenRequest.setState({ requestId: null })
    useActivityStore.setState({ live: { code: {}, thread: {} } } as never)
    useWorkspaceStore.setState({ workspaces: [{ id: 'ws-1', name: 'demo-repo', rootPath: '/repo', defaultShellProfileId: 'builtin-claude',
      panes: ['pane-1', 'pane-2'].map(id => ({ id, workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName: null, shellProfileId: 'builtin-claude', rootPath: null, createdAt: null })) } as unknown as Workspace] } as never)
    useTerminalStore.setState({ activePaneId: null } as never)
  })
}
const queue = (): HTMLElement => {
  const found = document.querySelectorAll<HTMLElement>('[data-ui="needs-you-queue"]')
  expect(found, 'one needs-you-queue').toHaveLength(1)
  return found[0]
}
const items = (): HTMLElement[] => [...queue().querySelectorAll<HTMLElement>('[data-ui="needs-you-item"]')]
const focusedItem = (): number => items().findIndex(item => item.contains(document.activeElement))
async function open(count: number): Promise<HTMLElement> {
  const pill = await screen.findByTestId('needs-you-pill')
  await waitFor(() => expect(pill).toHaveTextContent(i18n.t('attention.needsYou', { count }) as string))
  pill.focus()
  fireEvent.click(pill)
  await waitFor(() => expect(items().length).toBeGreaterThan(0))
  return pill
}
const key = (code: string): void => { fireEvent.keyDown(document.activeElement ?? document.body, { key: code }); fireEvent.keyUp(document.activeElement ?? document.body, { key: code }) }
const decided = (id: string, decision: string): boolean => respond.mock.calls.some(call => call[1] === id && (call[2] as { decision?: string } | undefined)?.decision === decision)

beforeEach(() => fixture([THREE]))
afterEach(async () => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-73 BRD-10 the needs-you queue (A26)', () => {
  it.each([['en', 'Deny', 'Allow once', 'See impact'], ['pt-BR', 'Negar', 'Permitir uma vez', 'Ver impacto']])('the pill (%s) opens the queue: the exact command, Deny and Allow once, and only See impact on a critical request', async (locale, deny, allow, impact) => {
    await changeLanguage(locale)
    render(<NeedsYouPill />)
    await open(3)
    expect(items()).toHaveLength(3)
    items().forEach((item, index) => {
      expect(item).toHaveAttribute('data-kind', 'request')
      expect(item.querySelector('code')?.textContent, `item ${index} shows its command`).toBe(Object.values(COMMANDS)[index])
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

  it('J and K move the focus, D denies and A allows the focused item', async () => {
    render(<NeedsYouPill />)
    await open(3)
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

  it('a critical item is never allowed from the queue, by a press or by holding', async () => {
    render(<NeedsYouPill />)
    await open(3)
    key('j')
    expect(focusedItem()).toBe(1)
    vi.useFakeTimers()
    key('a')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'a' })
    act(() => { vi.advanceTimersByTime(3_000) })
    fireEvent.keyUp(document.activeElement ?? document.body, { key: 'a' })
    expect(decided('r2', 'accept')).toBe(false)
  })

  it('the risk label is the catalog\'s word for main\'s risk, never the agent\'s text', async () => {
    render(<NeedsYouPill />)
    await open(3)
    const labels = items().map(item => [...item.querySelectorAll('[data-ui="risk-label"]')].map(el => (el.textContent ?? '').trim()))
    expect(labels[0]).toEqual([])
    expect(labels[2]).toEqual([])
    expect(labels[1]).toHaveLength(1)
    expect(labels[1][0]).toContain(i18n.t('approvals.risk.critical') as string)
  })

  it.each(['en', 'pt-BR'])('OXE-176 (%s): a waiting terminal is a row after the requests, with Ir ao terminal and no decision; the pill counts the rows', async locale => {
    await changeLanguage(locale)
    fixture([threadRow([request('r1', 1, 'low'), request('r3', 3, 'low')]), paneRow('pane-1', 'needs-you')])
    render(<NeedsYouPill />)
    await open(3)
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
    fixture([threadRow([request('r1', 1, 'low')]), other('f1', 'failed', 'code'), other('f2', 'failed', 'code'), other('f3', 'failed', 'thread'), other('f4', 'failed', 'thread'),
      other('w1', 'working', 'code'), other('w2', 'working', 'code'), other('w3', 'working', 'code'), other('w4', 'working', 'thread'), other('w5', 'working', 'thread'), other('i1', 'idle', 'thread')])
    render(<NeedsYouPill />)
    await open(1)
    const groups = [...queue().querySelectorAll<HTMLElement>('[data-ui="needs-you-group"]')]
    expect(groups.map(group => group.getAttribute('data-state'))).toEqual(['needs-you', 'failed', 'working'])
    groups.forEach((group, index) => expect(group.textContent ?? '', `group ${index} names its state`).toContain(words[index]))
    const rows = (group: HTMLElement): number => group.querySelectorAll('[data-ui="needs-you-row"]').length
    expect([rows(groups[1]), rows(groups[2])]).toEqual([3, 3])
    expect(groups[1].textContent ?? '').toMatch(/\+1(\D|$)/)
    expect(groups[2].textContent ?? '').toMatch(/\+2(\D|$)/)
  })

  it('Esc closes the queue and gives the focus back; closed, J K D A type normally', async () => {
    render(<><NeedsYouPill /><textarea aria-label="composer" /><div className="xterm" tabIndex={0} data-testid="terminal" /></>)
    const pill = await open(3)
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
