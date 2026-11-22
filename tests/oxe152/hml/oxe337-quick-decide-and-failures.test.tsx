// Frozen acceptance test for 1.5.2 HML fixes (Jira OXE-337, HML P1 · security, on 07d8df07c). Written by the planner;
// the executor must not edit it. Approval safety (hard rule): nothing risky is approved in one click from a list
// that shows only the command, and a failed answer is never swallowed.
// Contract:
// - src/components/Navigation/NeedsYouQueue.tsx: Deny and Allow once (by click or D/A) only for a conversation's
//   approval main judged risk 'low' that is not known to be irreversible (reversible true or null, as BRD-10's
//   brd10-needs-you-queue proves). Medium, high, critical, or reversible === false: only See impact (f7.card.seeImpact). When window.oxe.thread.respond rejects, the row stays and
//   an element with role="alert" inside the queue reads thread f7.queue.respondFailed.
// - src/components/Approvals/ApprovalQueue.tsx: while an answer is being sent, Deny and Approve are disabled (one
//   onRespond per click burst); a rejected onRespond shows role="alert" with f7.queue.respondFailed. Always allow:
//   when window.oxe.approvals.alwaysAllow answers { ok: false } or throws, role="alert" reads f7.alwaysAllow.failed and
//   nothing is approved (onRespond is not called).
// - thread catalogs: en f7.queue.respondFailed "Couldn't send your answer. Try again.", en f7.alwaysAllow.failed
//   "Couldn't add the rule. Nothing was approved."; both keys present and non-empty in pt-BR.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentRow } from '../../../shared/types/agents'
import { ApprovalQueue } from '../../../src/components/Approvals/ApprovalQueue'
import { useOpenRequest } from '../../../src/components/Approvals/openRequest'
import { NeedsYouQueue } from '../../../src/components/Navigation/NeedsYouQueue'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

const catalogs: Record<string, unknown> = {}
function cat(key: string, lang: 'en' | 'pt-BR' = 'en'): string {
  catalogs[lang] ??= JSON.parse(readFileSync(join(process.cwd(), `shared/locales/${lang}/thread.json`), 'utf8'))
  let node: unknown = catalogs[lang]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} thread catalog has no key ${key}`)
  return node
}

const row = (risk: string, reversible: boolean | null): AgentRow => ({
  kind: 'thread', id: 'thread-1', state: 'needs-you', provider: 'claude', mode: 'thread', title: 'Auth', workspaceId: 'ws-1',
  since: 1, seenAt: null, session: null, worktree: null, cost: null,
  requests: [{ requestId: 'r1', kind: 'approval', title: { code: 'agents.request.approval', params: {} }, risk, reversible, answerable: true, since: 1, command: { text: 'npm publish', untrusted: true } }]
}) as unknown as AgentRow

function renderQueue(agents: AgentRow[], respond = vi.fn(async () => undefined)) {
  useWorkspaceStore.setState({ workspaces: [] } as never)
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { respond } } })
  const anchor = createRef<HTMLElement>()
  const view = render(<><span ref={anchor as never} /><NeedsYouQueue agents={agents} anchor={anchor} onClose={vi.fn()} /></>)
  return { respond, view }
}

const approval = (over: Record<string, unknown> = {}) => ({
  id: 'r1', nativeId: 'n1', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Run npm test', command: 'npm test',
  generation: 1, createdAt: 1, state: 'pending',
  impact: { where: 'C:/dev/shop', affects: { count: null, unit: 'files' }, reversible: true, risk: 'low', kind: 'command', text: 'npm test', lang: 'shell' },
  ...over
})

afterEach(() => {
  cleanup()
  act(() => { useOpenRequest.getState().close() })
  vi.restoreAllMocks()
})

describe('OXE-337 · The needs-you queue decides only low-risk reversible approvals', () => {
  test('the failure messages exist in both languages', () => {
    expect(cat('f7.queue.respondFailed')).toBe("Couldn't send your answer. Try again.")
    expect(cat('f7.alwaysAllow.failed')).toBe("Couldn't add the rule. Nothing was approved.")
    expect(cat('f7.queue.respondFailed', 'pt-BR').length).toBeGreaterThan(0)
    expect(cat('f7.alwaysAllow.failed', 'pt-BR').length).toBeGreaterThan(0)
  })

  test('medium, high or irreversible approvals offer only See impact, and A approves nothing', async () => {
    const cases: Array<[string, boolean | null]> = [['medium', true], ['medium', null], ['high', true], ['low', false]]
    for (const [risk, reversible] of cases) {
      const { respond } = renderQueue([row(risk, reversible)])
      expect(screen.queryByRole('button', { name: cat('f7.card.allowOnce') }), `${risk}/${reversible}`).toBeNull()
      const seeImpact = screen.getByRole('button', { name: cat('f7.card.seeImpact') })
      const item = seeImpact.closest('[data-kind="request"]') as HTMLElement
      item.focus()
      fireEvent.keyDown(item, { key: 'a' })
      expect(respond, `${risk}/${reversible}`).not.toHaveBeenCalled()
      cleanup()
    }
  })

  test('a low-risk reversible approval can be allowed here, and a failed answer is shown, not swallowed', async () => {
    const respond = vi.fn(async () => { throw new Error('connection lost') })
    renderQueue([row('low', true)], respond)
    await userEvent.click(screen.getByRole('button', { name: cat('f7.card.allowOnce') }))
    expect(respond).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('alert')).toHaveTextContent(cat('f7.queue.respondFailed'))
    expect(screen.getByRole('button', { name: cat('f7.card.allowOnce') })).toBeInTheDocument()
  })
})

describe('OXE-337 · The approvals queue sends one answer and shows a failed one', () => {
  test('while an answer is on its way Approve is disabled; a rejected answer is shown', async () => {
    let reject: (error: Error) => void = () => undefined
    const onRespond = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    render(<ApprovalQueue items={[{ request: approval() as never, agent: 'Claude', conversation: 'Auth', threadId: 'thread-1' }]} decided={[]} onRespond={onRespond} initialSelectedId="r1" />)
    const approve = screen.getByRole('button', { name: new RegExp(`^${cat('request.approve')}`) })
    fireEvent.click(approve)
    fireEvent.click(approve)
    expect(onRespond).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${cat('request.approve')}`) })).toBeDisabled())
    await act(async () => { reject(new Error('connection lost')) })
    expect(await screen.findByRole('alert')).toHaveTextContent(cat('f7.queue.respondFailed'))
  })

  test('Always allow that fails says so and approves nothing', async () => {
    const alwaysAllow = vi.fn(async () => ({ ok: false }))
    Object.defineProperty(window, 'oxe', { configurable: true, value: { approvals: { alwaysAllow } } })
    const onRespond = vi.fn(async () => undefined)
    const request = approval({ alwaysAllow: { offered: true, rule: { provider: 'claude', text: 'Bash(npm test)', scope: 'project' } } })
    render(<ApprovalQueue items={[{ request: request as never, agent: 'Claude', conversation: 'Auth', threadId: 'thread-1' }]} decided={[]} onRespond={onRespond} initialSelectedId="r1" />)
    await userEvent.click(screen.getByRole('button', { name: cat('f7.card.alwaysAllowEllipsis') }))
    const dialog = await screen.findByRole('dialog', { name: cat('f7.alwaysAllow.title') })
    await userEvent.click(within(dialog).getByRole('button', { name: cat('f7.alwaysAllow.confirm') }))
    await waitFor(() => expect(alwaysAllow).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('alert')).toHaveTextContent(cat('f7.alwaysAllow.failed'))
    expect(onRespond).not.toHaveBeenCalled()
  })
})
